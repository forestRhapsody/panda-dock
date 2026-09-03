import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

export const BALL_SIZE = 52
const EDGE_MARGIN = 8
/** 拖拽多少像素以上视为「拖动」，否则视为「点击」 */
const DRAG_THRESHOLD = 6

export interface BallPos {
  side: 'left' | 'right'
  topPx: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 纵向位置限制在视口内 */
export function clampBallTop(topPx: number): number {
  return clamp(
    topPx,
    EDGE_MARGIN,
    Math.max(EDGE_MARGIN, window.innerHeight - BALL_SIZE - EDGE_MARGIN),
  )
}

interface DragState {
  /** 当前元素左上角位置 */
  x: number
  y: number
  /** 按下点在元素内的偏移 */
  grabX: number
  grabY: number
  moved: boolean
  active: boolean
}

interface FloatingBallProps {
  pos: BallPos
  /** 拖拽结束后（贴边完成）回调 */
  onDrop: (pos: BallPos) => void
  /** 轻点（未拖动）回调 */
  onToggle: () => void
}

/**
 * 悬浮球：可自由拖拽，松手自动吸附到最近的左/右屏幕边缘；
 * 停靠时鼠标移开只露出一半，悬停时完整滑出。
 */
export default function FloatingBall({ pos, onDrop, onToggle }: FloatingBallProps) {
  const dragRef = useRef<DragState | null>(null)
  const [dragXY, setDragXY] = useState<{ x: number; y: number } | null>(null)
  const [hovered, setHovered] = useState(false)

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = {
      x: rect.left,
      y: rect.top,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      moved: false,
      active: true,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setHovered(true)
    setDragXY({ x: rect.left, y: rect.top })
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d?.active) return
    const nextX = clamp(e.clientX - d.grabX, 0, Math.max(0, window.innerWidth - BALL_SIZE))
    const nextY = clampBallTop(e.clientY - d.grabY)
    if (Math.hypot(nextX - d.x, nextY - d.y) >= DRAG_THRESHOLD) d.moved = true
    d.x = nextX
    d.y = nextY
    setDragXY({ x: nextX, y: nextY })
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d?.active) return
    d.active = false
    dragRef.current = null
    setDragXY(null)

    if (d.moved) {
      // 吸附到水平方向更近的一侧
      const centerX = d.x + BALL_SIZE / 2
      const side = centerX <= window.innerWidth / 2 ? 'left' : 'right'
      onDrop({ side, topPx: clampBallTop(d.y) })
    } else {
      onToggle()
    }
    // 松手后鼠标若仍停在球上则保持展开
    setHovered(document.elementFromPoint(e.clientX, e.clientY)?.closest('.tek__ball') != null)
  }

  const visible = hovered || dragXY != null

  let style: CSSProperties
  if (dragXY) {
    style = { left: dragXY.x, top: dragXY.y, transition: 'none' }
  } else {
    // 未悬停时只露一半：沿边缘向内收 50% 宽度
    const translate = visible
      ? 'translateX(0)'
      : pos.side === 'left'
        ? 'translateX(-50%)'
        : 'translateX(50%)'
    style =
      pos.side === 'left'
        ? { left: 0, top: pos.topPx, transform: translate, transition: 'transform 0.3s ease' }
        : { right: 0, top: pos.topPx, transform: translate, transition: 'transform 0.3s ease' }
  }

  return (
    <div
      role='button'
      aria-label='打开工具箱'
      className={`tek__ball${dragXY ? ' tek__ball--drag' : ''}${visible ? ' tek__ball--visible' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      🧰
    </div>
  )
}
