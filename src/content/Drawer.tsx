import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import { useTranslation } from 'react-i18next'

import ToolsApp from '@/tools/ToolsApp'
import Icon from '@/ui/Icon'
import Tooltip from '@/ui/Tooltip'
import { isExtension, storageGet, storageSet } from '@/utils/env'

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

interface DrawerProps {
  onClose: () => void
}

/** 网页内右侧抽屉：承载与原生侧边栏同一套工具箱（运行时挂载在 Shadow DOM 内），左缘可拖拽调宽 */
export default function Drawer({ onClose }: DrawerProps) {
  const { t } = useTranslation()
  const inExt = isExtension()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // 记忆的宽度 + 窗口变化时收敛到可视范围
  useEffect(() => {
    let alive = true
    if (inExt) {
      void storageGet<number>('local', WIDTH_KEY).then((saved) => {
        if (alive && typeof saved === 'number') setWidth(clampWidth(saved))
      })
    }
    const onResize = () => setWidth((w) => clampWidth(w))
    window.addEventListener('resize', onResize)
    return () => {
      alive = false
      window.removeEventListener('resize', onResize)
    }
  }, [inExt])

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
    dragRef.current = { startX: e.clientX, startWidth: width }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  function onResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d) return
    // 向左拖变宽
    const next = clampWidth(d.startWidth + (d.startX - e.clientX))
    setWidth(next)
  }

  function onResizeEnd() {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    persist(width)
  }

  function onResizeKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 60 : 20
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = clampWidth(width + step)
      setWidth(next)
      persist(next)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = clampWidth(width - step)
      setWidth(next)
      persist(next)
    }
  }

  return (
    <div
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
      <ToolsApp
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
    </div>
  )
}
