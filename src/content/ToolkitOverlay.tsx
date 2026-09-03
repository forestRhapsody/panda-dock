import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useLocale } from '@/i18n/useLocale'
import { isExtension, storageGet, storageSet } from '@/utils/env'
import { useFontScale } from '@/utils/fontScale'
import type { BallAction } from '@/utils/messages'
import {
  MSG_CLOSE_DRAWER,
  MSG_CLOSE_NATIVE_SIDE_PANEL,
  MSG_OPEN_DRAWER,
  MSG_OPEN_NATIVE_SIDE_PANEL,
  MSG_TOGGLE_DRAWER,
} from '@/utils/messages'
import { useTheme } from '@/utils/theme'

import Drawer from './Drawer'
import FloatingBall, { clampBallPos, DOCK_H, snapToEdge } from './FloatingBall'
import type { BallPos } from './FloatingBall'

const POS_KEY = 'toolkit.ballPos'
const SETTINGS_KEY = 'settings'
const EDGE_MARGIN = 8
/** 默认纵向位置：视口高度 45% 处 */
const DEFAULT_Y_FRAC = 0.45
const DEFAULT_BALL_ACTION: BallAction = 'drawer'

/** 默认位置：吸边时为左缘；自由模式为右缘（完整显示） */
function defaultPos(snap: boolean): BallPos {
  return snap
    ? { x: 0, y: fracToTop(DEFAULT_Y_FRAC) }
    : { x: Math.max(0, window.innerWidth - DOCK_H - EDGE_MARGIN), y: fracToTop(DEFAULT_Y_FRAC) }
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
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function fracToTop(yFrac: number): number {
  const range = Math.max(1, window.innerHeight - EDGE_MARGIN * 2 - DOCK_H)
  return EDGE_MARGIN + clamp01(yFrac) * range
}

/** 根据存档（含旧格式）与吸边开关解析出位置 */
function resolvePos(saved: SavedPos | null, snap: boolean): BallPos {
  let pos: BallPos
  if (saved?.x != null && saved?.y != null) {
    pos = { x: saved.x, y: saved.y }
  } else {
    // 旧格式 { side, yFrac }
    const side = saved?.side === 'left' ? 'left' : 'right'
    pos = {
      x: side === 'left' ? 0 : Math.max(0, window.innerWidth - DOCK_H),
      y: fracToTop(saved?.yFrac ?? DEFAULT_Y_FRAC),
    }
  }
  return snap ? snapToEdge(pos) : clampBallPos(pos)
}

/** 请 background 尽力唤起浏览器原生侧边栏（受用户手势限制，可能失败） */
async function requestNativeSidePanel(): Promise<boolean> {
  try {
    const result = await chrome.runtime.sendMessage({ action: MSG_OPEN_NATIVE_SIDE_PANEL })
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
  const [pos, setPos] = useState<BallPos>(() => defaultPos(true))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200)
  }, [])

  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

  // 首次读取：快捷开关/点击行为/吸边 + 记忆位置（并行，读完统一生效避免闪烁）
  useEffect(() => {
    if (!inExt) return
    let alive = true

    void Promise.all([
      storageGet<StoredSettings>('sync', SETTINGS_KEY),
      storageGet<SavedPos>('local', POS_KEY),
    ]).then(([settings, saved]) => {
      if (!alive) return
      if (settings?.quickOpen != null) setQuickOpen(settings.quickOpen)
      if (settings?.ballAction === 'drawer' || settings?.ballAction === 'native') {
        setBallAction(settings.ballAction)
      }
      const snap = settings?.ballSnap !== false
      setBallSnap(snap)
      setPos(resolvePos(saved, snap))
      setReady(true)
    })

    const onResize = () => setPos((p) => (ballSnap ? snapToEdge(p) : clampBallPos(p)))
    window.addEventListener('resize', onResize)

    return () => {
      alive = false
      window.removeEventListener('resize', onResize)
    }
  }, [inExt, ballSnap])

  // 配置即时同步：Options 修改后已打开的页面无需刷新即可生效
  useEffect(() => {
    if (!inExt) return
    const applyStored = (s: StoredSettings | null | undefined) => {
      if (s?.quickOpen != null) setQuickOpen(s.quickOpen)
      if (s?.ballAction === 'drawer' || s?.ballAction === 'native') setBallAction(s.ballAction)
      if (s?.ballSnap != null) {
        setBallSnap(s.ballSnap)
        // 切到吸边时立刻把当前球贴回最近一侧
        if (s.ballSnap) setPos((p) => snapToEdge(p))
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
  }, [inExt])

  // 接收来自扩展页的抽屉消息：切换 / 强制打开。
  // 强制打开只把抽屉这一帧设为开，不改 ballAction —— 即不影响点击悬浮球的默认行为。
  useEffect(() => {
    if (!inExt) return
    const listener = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      const action = (message as { action?: string })?.action
      if (action === MSG_TOGGLE_DRAWER) {
        setDrawerOpen((open) => !open)
      } else if (action === MSG_OPEN_DRAWER) {
        setDrawerOpen(true)
        sendResponse({ ok: true })
      } else if (action === MSG_CLOSE_DRAWER) {
        setDrawerOpen(false)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [inExt])

  // 拖拽结束后落点：更新状态 + 持久化（存绝对坐标）
  const handleDrop = useCallback(
    (next: BallPos) => {
      const clamped = ballSnap ? snapToEdge(next) : clampBallPos(next)
      setPos(clamped)
      if (inExt) {
        void storageSet('local', POS_KEY, { x: clamped.x, y: clamped.y })
      }
    },
    [inExt, ballSnap],
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

  if (!ready || (quickOpen === false && inExt)) return null

  return (
    <>
      <FloatingBall pos={pos} snap={ballSnap} onDrop={handleDrop} onToggle={handleBallClick} />
      {drawerOpen && <Drawer onClose={() => setDrawerOpen(false)} />}
      {notice && inExt && (
        <div className='tek__toast' role='status'>
          {notice}
        </div>
      )}
    </>
  )
}
