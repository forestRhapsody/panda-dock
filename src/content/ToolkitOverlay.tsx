import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useLocale } from '@/i18n/useLocale'
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
      try {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
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
      } catch {
        // 忽略跨域 iframe 或特殊选区异常
      }

      if (!rect && e.target instanceof HTMLElement) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          const r = e.target.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) {
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

      lastCtxPos.current = {
        x: e.clientX,
        y: e.clientY,
        targetRect: rect,
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

    // 1. 检查当前网页是否有选中文本
    let selText = ''
    let rect: SelectionRect | undefined
    try {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const raw = sel.toString().trim()
        if (raw) {
          selText = raw
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
      // 忽略
    }

    if (selText) {
      // 选中文字的情况下：出现的位置和之前一样（正下方/上方居中跟随）
      setSelectionDetect({
        text: selText,
        x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
        y: rect ? rect.bottom : window.innerHeight / 2,
        targetRect: rect,
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

  // 页面内直接监听 Alt+Shift+S（或 Option+Shift+S）作为双保险，
  // 确保在任何网页中开箱即用，即使 Chrome 快捷键注册尚未同步也能即时生效
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault()
        triggerDetect()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [triggerDetect])

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
        // 右键菜单「智能解析选中文字」→ 弹出悬浮面板（位置优先取选区矩形，否则取右键点）
        const { text } = message as { text?: string }
        if (text) {
          let rect = lastCtxPos.current.targetRect
          if (!rect) {
            try {
              const sel = window.getSelection()
              if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
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
            } catch {
              // 忽略
            }
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

  // 悬浮球点击：抽屉开着则收起；否则按配置唤起原生侧边栏或打开抽屉
  const handleBallClick = useCallback(() => {
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

  // 划选弹窗点击「带入侧边栏并解析」
  const handleOpenInSidePanel = useCallback(
    async (text: string) => {
      // 1. 设置会话草稿与激活 tab 为 detect（无论侧边栏还是抽屉都会通过 onChanged 或首屏恢复）
      await storageSet('session', 'toolkit.draft.detect.input', text)
      await storageSet('session', 'toolkit.draft.activeToolTab', 'detect')

      // 2. 保证 detect 工具处于启用状态（若用户曾禁用则自动恢复）
      void storageGet<{ toolEnabled?: Record<string, boolean> }>('sync', 'settings').then((cur) => {
        if (cur?.toolEnabled && cur.toolEnabled.detect === false) {
          void storageSet('sync', 'settings', {
            ...cur,
            toolEnabled: { ...cur.toolEnabled, detect: true },
          })
        }
      })

      // 3. 尝试唤起原生侧边栏（forceOpen: true 避免意外收起已开的侧边栏）
      if (inExt) {
        const ok = await requestNativeSidePanel(true)
        if (ok) {
          setDrawerOpen(false)
        } else {
          // 若浏览器不支持原生侧边栏或唤起受限，友好回退打开网页内抽屉
          showNotice(t('toast.nativeSidePanelFallback'))
          setDrawerOpen(true)
        }
      } else {
        setDrawerOpen(true)
      }

      // 4. 关闭网页内悬浮选区面板
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
          onOpenInSidePanel={handleOpenInSidePanel}
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
