import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import { useTranslation } from 'react-i18next'

import ToolsApp from '@/tools/ToolsApp'
import Icon from '@/ui/Icon'
import Tooltip from '@/ui/Tooltip'
import { WindowScopeContext } from '@/utils/draft'
import { isExtension, storageGet, storageSet } from '@/utils/env'
import { MSG_GET_WINDOW_ID } from '@/utils/messages'

const WIDTH_KEY = 'toolkit.drawerWidth'
const MIN_WIDTH = 280
const DEFAULT_WIDTH = 400

/** 允许的最大宽度（留出页面可见空间） */
function maxDrawerWidth(): number {
  return Math.max(MIN_WIDTH, window.innerWidth - 80)
}

function clampWidth(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), maxDrawerWidth())
}

/** 能按选择器查询子树、并暴露「当前焦点元素」的节点（document / ShadowRoot 都满足） */
interface QueryRoot {
  querySelector?: (selectors: string) => Element | null
  activeElement?: Element | null
}

/**
 * 比抽屉更内层的浮层：**只要存在**就必须让行（它们本身就是模态 / 瞬态交互），
 * 否则会出现「内层浮层和抽屉一起关掉」。
 * - `.tk-modal`：ConfirmDialog / Cookie 编辑 / QR 裁剪弹窗
 * - `.tk-select-popup`：TkSelect 下拉
 * - `.tek-detect-panel`：网页内划选解析面板（与抽屉同在 content 影子根里）
 */
const INNER_LAYER_SELECTOR = '.tk-modal, .tk-select-popup, .tek-detect-panel'

/**
 * 自己处理 Escape 的内层交互区（如网页存储的内联编辑器、带筛选词的搜索框）。
 * 按**焦点**而不是「存在」判定：搜索框在有数据时会长期留在 DOM 里，
 * 若按存在判定，抽屉此后再也无法用 Escape 关闭；只有焦点真的落在里面，按键才归它。
 */
const ESCAPE_OWNER_SELECTOR = '[data-tk-escape]'

/**
 * 判断给定 root（网页里是 Content Script 的 ShadowRoot，测试里是 document）里是否有人先接管 Escape。
 * 焦点查询走 root.activeElement（影子根内的焦点元素），document.activeElement 在影子 DOM 里只会返回宿主。
 */
function innerHandlesEscape(root: Node | null | undefined): boolean {
  const node = root as QueryRoot | null | undefined
  if (typeof node?.querySelector !== 'function') return false
  if (node.querySelector(INNER_LAYER_SELECTOR) !== null) return true
  return node.activeElement?.closest?.(ESCAPE_OWNER_SELECTOR) != null
}

interface DrawerProps {
  onClose: () => void
}

/** 网页内右侧抽屉：承载与原生侧边栏同一套工具箱（运行时挂载在 Shadow DOM 内），左缘可拖拽调宽 */
export default function Drawer({ onClose }: DrawerProps) {
  const { t } = useTranslation()
  const inExt = isExtension()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [windowId, setWindowId] = useState<number | null>(() => (inExt ? null : 0))
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  // 宽度最新值的镜像：拖拽期间 pointermove → pointerup 可能落在同一批次，
  // 此时事件闭包里的 width 还是上一次渲染的旧值，直接持久化会写错，统一经 ref 读写。
  const widthRef = useRef(width)
  const rootRef = useRef<HTMLDivElement>(null)

  // 获取当前网页所在的 windowId，使网页抽屉与同窗口原生侧边栏处于同一工作区
  useEffect(() => {
    if (!inExt) return
    let alive = true
    void (async () => {
      let resolvedId: number | null = null
      try {
        const res = await chrome.runtime?.sendMessage?.({ action: MSG_GET_WINDOW_ID })
        if (res?.ok && typeof res.data === 'number') {
          resolvedId = res.data
        }
      } catch {
        // 忽略
      }
      if (alive) {
        setWindowId(resolvedId ?? 0)
      }
    })()
    return () => {
      alive = false
    }
  }, [inExt])

  // 记忆的宽度 + 窗口变化时收敛到可视范围
  useEffect(() => {
    let alive = true
    if (inExt) {
      void storageGet<number>('local', WIDTH_KEY).then((saved) => {
        if (alive && typeof saved === 'number') {
          const next = clampWidth(saved)
          widthRef.current = next
          setWidth(next)
        }
      })
    }
    const onResize = () => {
      const next = clampWidth(widthRef.current)
      widthRef.current = next
      setWidth(next)
    }
    window.addEventListener('resize', onResize)
    return () => {
      alive = false
      window.removeEventListener('resize', onResize)
    }
  }, [inExt])

  // Escape 关闭抽屉；但若影子根里有人该先接管（更内层的浮层，或焦点正落在声明了
  // `data-tk-escape` 的内联编辑 / 搜索框里，见 innerHandlesEscape），Escape 必须先让给它们，
  // 否则会出现「按 Escape 退出编辑却把整个抽屉关掉」。
  // 用捕获阶段：TkSelect 的 React 处理器会在事件冒泡到 container 时同步把下拉卸载掉，
  // 冒泡阶段再查 DOM 就查不到 `.tk-select-popup` 了，会误关整个抽屉。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (innerHandlesEscape(rootRef.current?.getRootNode())) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  // 拖拽结束后持久化宽度
  const persist = useCallback(
    (next: number) => {
      if (inExt) void storageSet('local', WIDTH_KEY, next)
    },
    [inExt],
  )

  function onResizeStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: widthRef.current }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  function onResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d) return
    // 向左拖变宽
    const next = clampWidth(d.startWidth + (d.startX - e.clientX))
    widthRef.current = next
    setWidth(next)
  }

  function onResizeEnd() {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    // 经 ref 读当前宽度：同一批次内连续 pointermove 后的 pointerup 若读闭包 width，
    // 会拿到尚未提交的旧值，持久化就会写错。
    persist(widthRef.current)
  }

  function onResizeKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 60 : 20
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = clampWidth(widthRef.current + step)
      widthRef.current = next
      setWidth(next)
      persist(next)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = clampWidth(widthRef.current - step)
      widthRef.current = next
      setWidth(next)
      persist(next)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`tek__drawer${dragging ? ' tek__drawer--resizing' : ''}`}
      style={{ width: `${clampWidth(width)}px` }}
      role='dialog'
      aria-label={t('drawer.ariaLabel')}
    >
      <div
        role='separator'
        aria-orientation='vertical'
        aria-label={t('drawer.ariaResize')}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxDrawerWidth()}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        className='tek__drawer-handle'
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onKeyDown={onResizeKey}
      />
      {windowId !== null && (
        <WindowScopeContext.Provider value={windowId > 0 ? windowId : null}>
          <ToolsApp
            key={windowId}
            headerActions={
              <Tooltip content={t('drawer.ariaClose')} side='bottom'>
                <button
                  type='button'
                  className='tk-icon-btn'
                  aria-label={t('drawer.ariaClose')}
                  onClick={onClose}
                >
                  <Icon name='close' size={14} />
                </button>
              </Tooltip>
            }
          />
        </WindowScopeContext.Provider>
      )}
    </div>
  )
}
