import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useLocale } from '@/i18n/useLocale'
import { prepareToolHandoff } from '@/tools/handoff'
import type { ToolId } from '@/tools/registry'
import { shouldShowFloatingBall } from '@/utils/domainMatch'
import { isExtension, storageGet, storageSet } from '@/utils/env'
import { useFontScale } from '@/utils/fontScale'
import type { BallAction } from '@/utils/messages'
import {
  MSG_CLOSE_DRAWER,
  MSG_CLOSE_NATIVE_SIDE_PANEL,
  MSG_DETECT_SELECTION,
  MSG_OPEN_DRAWER,
  MSG_OPEN_NATIVE_SIDE_PANEL,
  MSG_TOGGLE_DETECT,
  MSG_TOGGLE_DRAWER,
} from '@/utils/messages'
import type { BallPreset, BallShape, BallSize, DomainMatchMode } from '@/utils/settings'
import { BALL_IMAGE_KEY, BALL_SIZE_PX, getBallImage } from '@/utils/settings'
import { useTheme } from '@/utils/theme'

import Drawer from './Drawer'
import FloatingBall, { clampBallPos, snapToEdge } from './FloatingBall'
import type { BallPos } from './FloatingBall'
import SelectionDetectPanel, { type SelectionRect } from './SelectionDetectPanel'

const POS_KEY = 'toolkit.ballPos'
const SETTINGS_KEY = 'settings'
const EDGE_MARGIN = 8
/** 默认纵向位置：视口高度 45% 处 */
const DEFAULT_Y_FRAC = 0.45
const DEFAULT_BALL_ACTION: BallAction = 'drawer'

/** 默认位置：吸边时为左缘；自由模式为右缘（完整显示）。d = 悬浮球直径 */
function defaultPos(snap: boolean, d: number): BallPos {
  return snap
    ? { x: 0, y: fracToTop(DEFAULT_Y_FRAC, d) }
    : { x: Math.max(0, window.innerWidth - d - EDGE_MARGIN), y: fracToTop(DEFAULT_Y_FRAC, d) }
}

interface SavedPos {
  /** 旧格式：贴边方向 */
  side?: 'left' | 'right'
  /** 旧格式：纵向比例 */
  yFrac?: number
  /** 新格式：球左上角（视口坐标） */
  x?: number
  y?: number
}

interface StoredSettings {
  quickOpen?: boolean
  ballAction?: BallAction
  /** 悬浮球是否吸边（默认 true） */
  ballSnap?: boolean
  ballShape?: BallShape
  ballPreset?: BallPreset
  ballSize?: BallSize
  ballDomainMode?: DomainMatchMode
  ballBlacklist?: string[]
  ballWhitelist?: string[]
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function fracToTop(yFrac: number, d: number): number {
  const range = Math.max(1, window.innerHeight - EDGE_MARGIN * 2 - d)
  return EDGE_MARGIN + clamp01(yFrac) * range
}

/** 根据存档（含旧格式）与吸边开关解析出位置（d = 悬浮球直径） */
function resolvePos(saved: SavedPos | null, snap: boolean, d: number): BallPos {
  let pos: BallPos
  if (saved?.x != null && saved?.y != null) {
    pos = { x: saved.x, y: saved.y }
  } else {
    // 旧格式 { side, yFrac }
    const side = saved?.side === 'left' ? 'left' : 'right'
    pos = {
      x: side === 'left' ? 0 : Math.max(0, window.innerWidth - d),
      y: fracToTop(saved?.yFrac ?? DEFAULT_Y_FRAC, d),
    }
  }
  return snap ? snapToEdge(pos, d) : clampBallPos(pos, d)
}

/** 请 background 尽力唤起浏览器原生侧边栏（受用户手势限制，可能失败） */
async function requestNativeSidePanel(forceOpen = false): Promise<boolean> {
  try {
    const result = await chrome.runtime.sendMessage({
      action: MSG_OPEN_NATIVE_SIDE_PANEL,
      forceOpen,
    })
    return result === true
  } catch {
    return false
  }
}

/**
 * 精准计算 textarea 内选中文本所在行的包围盒（避免锚点落于高大 textarea 的最底部）
 */
function getTextareaSelectionRect(el: HTMLTextAreaElement, start: number): SelectionRect {
  const r = el.getBoundingClientRect()
  try {
    const textBefore = el.value.slice(0, start)
    const lineIndex = textBefore.split('\n').length - 1
    const computed = window.getComputedStyle(el)
    const lineHeight = parseFloat(computed.lineHeight) || 20
    const paddingTop = parseFloat(computed.paddingTop) || 0
    const estimatedTop = r.top + paddingTop + lineIndex * lineHeight - el.scrollTop
    const top = Math.max(r.top, Math.min(estimatedTop, r.bottom - lineHeight))
    const bottom = Math.max(r.top + lineHeight, Math.min(top + lineHeight, r.bottom))
    return {
      left: r.left,
      top,
      right: r.right,
      bottom,
      width: r.width,
      height: bottom - top,
    }
  } catch {
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    }
  }
}

/**
 * 获取 input 单行输入框的包围盒
 */
function getInputElementRect(el: HTMLInputElement): SelectionRect {
  const r = el.getBoundingClientRect()
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  }
}

/**
 * 深度获取当前页面选中的文本与定位矩形：
 * 1. 深度穿透查找当前聚焦的 activeElement，优先检查可编辑元素（input / textarea）；
 * 2. 其次检查普通 DOM 节点选区（window.getSelection()）。
 */
function getPageSelectionInfo(): { text: string; rect?: SelectionRect } | null {
  let activeEl: Element | null = document.activeElement
  while (activeEl?.shadowRoot?.activeElement) {
    activeEl = activeEl.shadowRoot.activeElement
  }

  if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
    const start = activeEl.selectionStart
    const end = activeEl.selectionEnd
    if (typeof start === 'number' && typeof end === 'number' && start < end) {
      const text = activeEl.value.slice(start, end).trim()
      if (text) {
        const rect =
          activeEl instanceof HTMLTextAreaElement
            ? getTextareaSelectionRect(activeEl, start)
            : getInputElementRect(activeEl)
        return { text, rect }
      }
    }
  }

  try {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const text = sel.toString().trim()
      if (text) {
        let rect: SelectionRect | undefined
        const r = sel.getRangeAt(0).getBoundingClientRect()
        if (r.width > 0 || r.height > 0) {
          rect = {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          }
        }
        return { text, rect }
      }
    }
  } catch {
    // 忽略异常
  }

  return null
}

/**
 * 注入到网页上的「悬浮球 + 网页内抽屉」。
 * - 悬浮球可拖拽贴靠屏幕左右两侧，鼠标移开只露一半
 * - 点击行为可配置：网页内抽屉（默认）/ 尽量唤起浏览器原生侧边栏（失败自动回退抽屉并提示）
 * - 配置修改通过 chrome.storage.onChanged 即时同步到已打开的页面（无需刷新）
 * - 位置通过 chrome.storage.local 跨页面记忆（浏览器预览时不持久化）
 * - 可被原生侧边栏页以消息唤起（MSG_TOGGLE_DRAWER）
 */
export default function ToolkitOverlay() {
  const { t } = useTranslation()
  const inExt = isExtension()
  useLocale()
  useFontScale()
  useTheme()
  // 非扩展环境（浏览器预览）无需等待读取，直接渲染
  const [ready, setReady] = useState(!inExt)
  const [quickOpen, setQuickOpen] = useState(true)
  const [ballAction, setBallAction] = useState<BallAction>(DEFAULT_BALL_ACTION)
  const [ballSnap, setBallSnap] = useState(true)
  const [ballShape, setBallShape] = useState<BallShape>('circle')
  const [ballPreset, setBallPreset] = useState<BallPreset>('primary')
  const [ballSize, setBallSize] = useState<BallSize>('md')
  const [ballImage, setBallImage] = useState<string | null>(null)
  const [ballDomainMode, setBallDomainMode] = useState<DomainMatchMode>('blacklist')
  const [ballBlacklist, setBallBlacklist] = useState<string[]>([])
  const [ballWhitelist, setBallWhitelist] = useState<string[]>([])
  const [pos, setPos] = useState<BallPos>(() => defaultPos(true, BALL_SIZE_PX.md))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectionDetect, setSelectionDetect] = useState<{
    text: string
    x?: number
    y?: number
    targetRect?: SelectionRect
    position?: 'selection' | 'top-right'
  } | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  // 记录最后一次右键位置与选区坐标，供「智能解析选中文字」悬浮面板定位
  const lastCtxPos = useRef<{
    x: number
    y: number
    targetRect?: SelectionRect
    selectedText?: string
  }>({ x: 8, y: 8 })

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200)
  }, [])

  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

  // 记录最后一次右键位置与选区坐标，供「智能解析选中文字」悬浮面板跟随
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      let rect: SelectionRect | undefined
      let selectedText = ''

      // 1. 若右键目标为可编辑输入框，优先读取该输入框内的选区与定位
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        const start = e.target.selectionStart
        const end = e.target.selectionEnd
        if (typeof start === 'number' && typeof end === 'number' && start < end) {
          selectedText = e.target.value.slice(start, end).trim()
          rect =
            e.target instanceof HTMLTextAreaElement
              ? getTextareaSelectionRect(e.target, start)
              : getInputElementRect(e.target)
        } else {
          rect =
            e.target instanceof HTMLTextAreaElement
              ? {
                  left: e.target.getBoundingClientRect().left,
                  top: e.clientY - 10,
                  right: e.target.getBoundingClientRect().right,
                  bottom: e.clientY + 10,
                  width: e.target.getBoundingClientRect().width,
                  height: 20,
                }
              : getInputElementRect(e.target)
        }
      }

      // 2. 否则尝试从常规 DOM 选区读取
      if (!selectedText) {
        try {
          const sel = window.getSelection()
          if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
            const raw = sel.toString().trim()
            if (raw) {
              selectedText = raw
              const r = sel.getRangeAt(0).getBoundingClientRect()
              if (r.width > 0 || r.height > 0) {
                rect = {
                  left: r.left,
                  top: r.top,
                  right: r.right,
                  bottom: r.bottom,
                  width: r.width,
                  height: r.height,
                }
              }
            }
          }
        } catch {
          // 忽略跨域 iframe 或特殊选区异常
        }
      }

      lastCtxPos.current = {
        x: e.clientX,
        y: e.clientY,
        targetRect: rect,
        selectedText,
      }
    }
    window.addEventListener('contextmenu', onCtx, true)
    return () => window.removeEventListener('contextmenu', onCtx, true)
  }, [])

  // 首次读取：快捷开关/点击行为/吸边/形状/预设/大小/图片 + 记忆位置（并行，读完统一生效避免闪烁）
  useEffect(() => {
    if (!inExt) return
    let alive = true

    void Promise.all([
      storageGet<StoredSettings>('sync', SETTINGS_KEY),
      storageGet<SavedPos>('local', POS_KEY),
      getBallImage(),
    ]).then(([settings, saved, image]) => {
      if (!alive) return
      if (settings?.quickOpen != null) setQuickOpen(settings.quickOpen)
      if (settings?.ballAction === 'drawer' || settings?.ballAction === 'native') {
        setBallAction(settings.ballAction)
      }
      if (settings?.ballShape != null) setBallShape(settings.ballShape)
      if (settings?.ballPreset != null) setBallPreset(settings.ballPreset)
      if (settings?.ballSize != null) setBallSize(settings.ballSize)
      if (image != null) setBallImage(image)
      if (settings?.ballDomainMode != null) setBallDomainMode(settings.ballDomainMode)
      if (settings?.ballBlacklist != null) setBallBlacklist(settings.ballBlacklist)
      if (settings?.ballWhitelist != null) setBallWhitelist(settings.ballWhitelist)
      const snap = settings?.ballSnap !== false
      setBallSnap(snap)
      setPos(resolvePos(saved, snap, BALL_SIZE_PX[settings?.ballSize ?? 'md']))
      setReady(true)
    })

    return () => {
      alive = false
    }
  }, [inExt])

  // 窗口尺寸变化时把球夹回视口内（随当前吸附与大小）
  useEffect(() => {
    if (!inExt) return
    const d = BALL_SIZE_PX[ballSize]
    const onResize = () => setPos((p) => (ballSnap ? snapToEdge(p, d) : clampBallPos(p, d)))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [inExt, ballSnap, ballSize])

  // 配置即时同步：Options 修改后已打开的页面无需刷新即可生效
  useEffect(() => {
    if (!inExt) return
    const applyStored = (s: StoredSettings | null | undefined) => {
      if (s?.quickOpen != null) setQuickOpen(s.quickOpen)
      if (s?.ballAction === 'drawer' || s?.ballAction === 'native') setBallAction(s.ballAction)
      if (s?.ballShape != null) setBallShape(s.ballShape)
      if (s?.ballPreset != null) setBallPreset(s.ballPreset)
      if (s?.ballSize != null) {
        const prev = s.ballSize
        setBallSize(prev)
        setPos((p) =>
          ballSnap ? snapToEdge(p, BALL_SIZE_PX[prev]) : clampBallPos(p, BALL_SIZE_PX[prev]),
        )
      }
      if (s?.ballDomainMode != null) setBallDomainMode(s.ballDomainMode)
      if (s?.ballBlacklist != null) setBallBlacklist(s.ballBlacklist)
      if (s?.ballWhitelist != null) setBallWhitelist(s.ballWhitelist)
      if (s?.ballSnap != null) {
        setBallSnap(s.ballSnap)
        // 切到吸边时立刻把当前球贴回最近一侧
        if (s.ballSnap) setPos((p) => snapToEdge(p, BALL_SIZE_PX[ballSize]))
      }
    }
    const reRead = () => {
      void storageGet<StoredSettings>('sync', SETTINGS_KEY).then(applyStored)
    }
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'sync' || changes[SETTINGS_KEY] == null) return
      applyStored(changes[SETTINGS_KEY].newValue as StoredSettings | undefined)
    }
    chrome.storage.onChanged.addListener(onChange)
    window.addEventListener('focus', reRead)
    return () => {
      chrome.storage.onChanged.removeListener(onChange)
      window.removeEventListener('focus', reRead)
    }
  }, [inExt, ballSnap, ballSize])

  // 自定义悬浮球图片（chrome.storage.local）变更即时同步
  useEffect(() => {
    if (!inExt) return
    const onLocal = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || changes[BALL_IMAGE_KEY] == null) return
      const next = changes[BALL_IMAGE_KEY].newValue as string | null | undefined
      setBallImage(next ?? null)
    }
    chrome.storage.onChanged.addListener(onLocal)
    return () => chrome.storage.onChanged.removeListener(onLocal)
  }, [inExt])

  const lastDetectTriggerRef = useRef(0)

  // 触发智能解析（扩展全局快捷键与页面内快捷键共用逻辑）
  const triggerDetect = useCallback(() => {
    const now = Date.now()
    if (now - lastDetectTriggerRef.current < 300) return
    lastDetectTriggerRef.current = now

    // 1. 检查当前网页是否有选中文本（同时深度支持 input / textarea / 普通 DOM 选区）
    const info = getPageSelectionInfo()
    if (info && info.text) {
      setSelectionDetect({
        text: info.text,
        x: info.rect ? info.rect.left + info.rect.width / 2 : window.innerWidth / 2,
        y: info.rect ? info.rect.bottom : window.innerHeight / 2,
        targetRect: info.rect,
        position: 'selection',
      })
      return
    }

    // 未选中文字的情况下：
    // 若当前面板已处于打开状态，再次按下快捷键执行收回（Toggle）！
    setSelectionDetect((prev) => {
      if (prev) {
        return null
      }
      return {
        text: '',
        position: 'top-right',
      }
    })
  }, [])

  const lastToggleTimeRef = useRef(0)

  // 切换工具箱开合（抽屉或侧边栏，根据 ballAction 配置）：
  // 悬浮球点击与快捷键 Alt+Shift+D 共用，附带 300ms 节流防抖，避免与 Chrome commands 广播重叠触发
  const toggleToolkit = useCallback(() => {
    const now = Date.now()
    if (now - lastToggleTimeRef.current < 300) return
    lastToggleTimeRef.current = now

    if (drawerOpen) {
      setDrawerOpen(false)
      return
    }
    if (ballAction === 'native' && inExt) {
      void requestNativeSidePanel().then((ok) => {
        if (!ok) {
          showNotice(t('toast.nativeSidePanelFallback'))
          setDrawerOpen(true)
        }
      })
      return
    }
    // 打开网页内抽屉前先把原生侧边栏关掉（互斥：两种工具箱不同时显示）
    if (inExt) void chrome.runtime.sendMessage({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
    setDrawerOpen(true)
  }, [ballAction, drawerOpen, inExt, showNotice, t])

  // 页面内直接监听 Alt+Shift+S / Alt+Shift+D（或 Option+Shift）作为双保险，
  // 确保在任何网页中开箱即用，即使 Chrome 快捷键注册延迟也能即时生效
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey || e.metaKey) && e.shiftKey) {
        if (e.key === 'S' || e.key === 's') {
          e.preventDefault()
          triggerDetect()
        } else if (e.key === 'D' || e.key === 'd') {
          e.preventDefault()
          toggleToolkit()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [toggleToolkit, triggerDetect])

  // 监听来自其他页面或扩展后台的消息
  useEffect(() => {
    if (!inExt) return
    const listener = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (res?: unknown) => void,
    ) => {
      const action = (message as { action?: string } | undefined)?.action
      if (action === MSG_TOGGLE_DRAWER) {
        const now = Date.now()
        if (now - lastToggleTimeRef.current < 300) {
          sendResponse({ ok: true })
          return
        }
        lastToggleTimeRef.current = now
        setDrawerOpen((prev) => {
          const next = !prev
          if (next && inExt) {
            void chrome.runtime.sendMessage({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
          }
          return next
        })
        sendResponse({ ok: true })
      } else if (action === MSG_OPEN_DRAWER) {
        setDrawerOpen(true)
        sendResponse({ ok: true })
      } else if (action === MSG_CLOSE_DRAWER) {
        setDrawerOpen(false)
        sendResponse({ ok: true })
      } else if (action === MSG_DETECT_SELECTION) {
        // 右键菜单「智能解析选中文字」→ 弹出悬浮面板（优先取选区矩形，否则取右键点）
        const { text: msgText } = message as { text?: string }
        const text = msgText || lastCtxPos.current.selectedText
        if (text) {
          let rect = lastCtxPos.current.targetRect
          if (!rect) {
            const info = getPageSelectionInfo()
            rect = info?.rect
          }
          setSelectionDetect({
            text,
            x: lastCtxPos.current.x,
            y: lastCtxPos.current.y,
            targetRect: rect,
            position: 'selection',
          })
        }
      } else if (action === MSG_TOGGLE_DETECT) {
        triggerDetect()
        sendResponse({ ok: true })
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [inExt, triggerDetect])

  // 拖拽结束后落点：更新状态 + 持久化（存绝对坐标）
  const handleDrop = useCallback(
    (next: BallPos) => {
      const d = BALL_SIZE_PX[ballSize]
      const clamped = ballSnap ? snapToEdge(next, d) : clampBallPos(next, d)
      setPos(clamped)
      if (inExt) {
        void storageSet('local', POS_KEY, { x: clamped.x, y: clamped.y })
      }
    },
    [inExt, ballSnap, ballSize],
  )

  // 悬浮球点击复用 toggleToolkit
  const handleBallClick = toggleToolkit

  /**
   * 把文本交给目标工具并在扩展宿主里打开：
   * 1) 先让目标工具就位（写会话草稿、激活 Tab、必要时启用——见 handoff.ts）；
   * 2) 原生侧边栏优先（forceOpen 避免误收起已开的侧边栏），受限时回退网页内抽屉；
   * 3) 关闭网页内的选区悬浮面板。
   * 工具没能就位（如启用写入失败）时直接返回：不能打开一个会显示错工具的宿主。
   */
  const openToolInHost = useCallback(
    async (tool: ToolId, text: string) => {
      const res = await prepareToolHandoff(tool, text)
      if (!res.ok) {
        if (res.reason === 'enable-failed') {
          showNotice(t('tool.detect.openInToolFailed', { tool: t(`tool.registry.${tool}`) }))
        }
        return
      }

      if (inExt) {
        const ok = await requestNativeSidePanel(true)
        if (ok) {
          setDrawerOpen(false)
        } else {
          showNotice(t('toast.nativeSidePanelFallback'))
          setDrawerOpen(true)
        }
      } else {
        setDrawerOpen(true)
      }

      setSelectionDetect(null)
    },
    [inExt, showNotice, t],
  )

  // 判定当前网页是否按黑白名单规则显示悬浮球
  const showBall = inExt
    ? shouldShowFloatingBall(
        {
          quickOpen,
          ballDomainMode,
          ballBlacklist,
          ballWhitelist,
        },
        typeof window !== 'undefined' ? window.location : undefined,
      )
    : quickOpen

  if (!ready) return null
  if (!showBall && !drawerOpen && !notice && !selectionDetect) return null

  return (
    <>
      {drawerOpen && <Drawer onClose={() => setDrawerOpen(false)} />}
      {showBall && (
        <FloatingBall
          pos={pos}
          snap={ballSnap}
          shape={ballShape}
          size={ballSize}
          preset={ballPreset}
          image={ballImage}
          onDrop={handleDrop}
          onToggle={handleBallClick}
        />
      )}
      {selectionDetect && (
        <SelectionDetectPanel
          text={selectionDetect.text}
          x={selectionDetect.x}
          y={selectionDetect.y}
          targetRect={selectionDetect.targetRect}
          position={selectionDetect.position}
          onClose={() => setSelectionDetect(null)}
          onOpenInSidePanel={(text) => void openToolInHost('detect', text)}
          onOpenInTool={(tool, text) => void openToolInHost(tool, text)}
        />
      )}
      {notice && inExt && (
        <div className='tek__toast' role='status'>
          {notice}
        </div>
      )}
    </>
  )
}
