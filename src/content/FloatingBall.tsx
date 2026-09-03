import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import Icon from '@/ui/Icon'

export const DOCK_H = 52 // 圆形悬浮球直径
const DOCK_R = DOCK_H / 2
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
export function clampDockTop(topPx: number): number {
  return clamp(topPx, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - DOCK_H - EDGE_MARGIN))
}

interface DownState {
  startPX: number
  startPY: number
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
 * 悬浮触发器（最初样式：圆形悬浮球）：
 * - 贴边停靠，鼠标移开只露一半、悬停完整滑出；
 * - 按住拖动：整圆以指针为中心跟随，松手按最近一侧贴回并记忆位置；
 * - 轻点（未位移）不产生任何定位变化，避免点击抽动。
 */
export default function FloatingBall({ pos, onDrop, onToggle }: FloatingBallProps) {
  const downRef = useRef<DownState | null>(null)
  const [hovered, setHovered] = useState(false)
  const [floatXY, setFloatXY] = useState<{ x: number; y: number } | null>(null)
  const lastXY = useRef({ x: 0, y: 0 })

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    downRef.current = {
      startPX: e.clientX,
      startPY: e.clientY,
      moved: false,
      active: true,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setHovered(true)
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = downRef.current
    if (!d?.active) return
    const dx = e.clientX - d.startPX
    const dy = e.clientY - d.startPY

    // 未超过阈值前保持原样，轻点=点击，绝不重新定位（消除抽动）
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      d.moved = true
    }

    // 拖动：整圆以指针为中心跟随
    const nextX = clamp(e.clientX - DOCK_R, 0, Math.max(0, window.innerWidth - DOCK_H))
    const nextY = clampDockTop(e.clientY - DOCK_R)
    lastXY.current = { x: nextX, y: nextY }
    setFloatXY(lastXY.current)
    setHovered(true)
  }

  function endDrag() {
    const d = downRef.current
    if (!d?.active) return
    d.active = false
    downRef.current = null
    setFloatXY(null)

    if (d.moved) {
      // 吸附到水平方向更近的一侧（按圆球圆心判定）
      const centerX = lastXY.current.x + DOCK_R
      const side = centerX <= window.innerWidth / 2 ? 'left' : 'right'
      onDrop({ side, topPx: clampDockTop(lastXY.current.y) })
    } else {
      onToggle()
    }
  }

  const visible = hovered || floatXY != null

  let style: CSSProperties
  if (floatXY) {
    // 拖动：整圆跟随指针
    style = { left: floatXY.x, top: floatXY.y, transition: 'none' }
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
      className={`tek__dock${floatXY ? ' tek__dock--drag' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Icon name='toolbox' size={22} />
    </div>
  )
}
