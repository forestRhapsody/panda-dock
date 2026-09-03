import { useCallback, useEffect, useRef, useState } from 'react'

import { isExtension, storageGet, storageSet } from '@/utils/env'
import type { BallAction } from '@/utils/messages'
import { MSG_OPEN_NATIVE_SIDE_PANEL, MSG_TOGGLE_DRAWER } from '@/utils/messages'

import Drawer from './Drawer'
import FloatingBall, { clampBallTop } from './FloatingBall'
import type { BallPos } from './FloatingBall'

const POS_KEY = 'toolkit.ballPos'
const SETTINGS_KEY = 'settings'
const EDGE_MARGIN = 8
const BALL_SIZE = 52
const DEFAULT_SIDE: BallPos['side'] = 'right'
/** 默认纵向位置：视口高度 45% 处 */
const DEFAULT_Y_FRAC = 0.45
const DEFAULT_BALL_ACTION: BallAction = 'drawer'

interface SavedPos {
  side?: BallPos['side']
  yFrac?: number
}

interface StoredSettings {
  quickOpen?: boolean
  ballAction?: BallAction
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function fracToTop(yFrac: number): number {
  const range = Math.max(1, window.innerHeight - EDGE_MARGIN * 2 - BALL_SIZE)
  return EDGE_MARGIN + clamp01(yFrac) * range
}

function topToFrac(topPx: number): number {
  const range = Math.max(1, window.innerHeight - EDGE_MARGIN * 2 - BALL_SIZE)
  return (clampBallTop(topPx) - EDGE_MARGIN) / range
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
  const inExt = isExtension()
  // 非扩展环境（浏览器预览）无需等待读取，直接渲染
  const [ready, setReady] = useState(!inExt)
  const [quickOpen, setQuickOpen] = useState(true)
  const [ballAction, setBallAction] = useState<BallAction>(DEFAULT_BALL_ACTION)
  const [pos, setPos] = useState<BallPos>({ side: DEFAULT_SIDE, topPx: fracToTop(DEFAULT_Y_FRAC) })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200)
  }, [])

  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

  // 首次读取：快捷开关/点击行为 + 记忆位置（并行，读完统一生效避免闪烁）
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
      setPos({
        side: saved?.side === 'left' ? 'left' : 'right',
        topPx: fracToTop(saved?.yFrac ?? DEFAULT_Y_FRAC),
      })
      setReady(true)
    })

    const onResize = () =>
      setPos((p) => ({
        ...p,
        topPx: Math.min(
          p.topPx,
          Math.max(EDGE_MARGIN, window.innerHeight - BALL_SIZE - EDGE_MARGIN),
        ),
      }))
    window.addEventListener('resize', onResize)

    return () => {
      alive = false
      window.removeEventListener('resize', onResize)
    }
  }, [inExt])

  // 配置即时同步：Options 修改后已打开的页面无需刷新即可生效
  useEffect(() => {
    if (!inExt) return
    const applyStored = (s: StoredSettings | null | undefined) => {
      if (s?.quickOpen != null) setQuickOpen(s.quickOpen)
      if (s?.ballAction === 'drawer' || s?.ballAction === 'native') setBallAction(s.ballAction)
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

  // 接收来自原生侧边栏页的「切换网页内抽屉」消息
  useEffect(() => {
    if (!inExt) return
    const listener = (message: unknown) => {
      if ((message as { action?: string })?.action === MSG_TOGGLE_DRAWER) {
        setDrawerOpen((open) => !open)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [inExt])

  // 拖拽结束后落点：更新状态 + 持久化
  const handleDrop = useCallback(
    (next: BallPos) => {
      setPos(next)
      if (inExt) {
        void storageSet('local', POS_KEY, { side: next.side, yFrac: topToFrac(next.topPx) })
      }
    },
    [inExt],
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
          showNotice('已尝试唤起浏览器原生侧边栏，但被 Chrome 手势限制拒绝，已改用网页内抽屉')
          setDrawerOpen(true)
        }
      })
      return
    }
    setDrawerOpen(true)
  }, [ballAction, drawerOpen, inExt, showNotice])

  if (!ready || (quickOpen === false && inExt)) return null

  return (
    <>
      <FloatingBall pos={pos} onDrop={handleDrop} onToggle={handleBallClick} />
      {drawerOpen && <Drawer onClose={() => setDrawerOpen(false)} />}
      {notice && inExt && (
        <div className='tek__toast' role='status'>
          {notice}
        </div>
      )}
    </>
  )
}
