import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { useTranslation } from 'react-i18next'

import type { BallPreset, BallShape, BallSize } from '@/utils/settings'
import { BALL_PRESET_OPTIONS, BALL_SIZE_PX, ballAssetUrl } from '@/utils/settings'

export const DOCK_H = BALL_SIZE_PX.md // 默认（中）直径，供定位兜底
const EDGE_MARGIN = 8
/** 拖拽多少像素以上视为「拖动」，否则视为「点击」 */
const DRAG_THRESHOLD = 6
/** 自由模式/拖拽中的 z-index：高于抽屉(2147483010)，低于轻提示(2147483012) */
const Z_ABOVE_DRAWER = 2147483011

export interface BallPos {
  /** 球左上角（视口坐标） */
  x: number
  /** 球左上角（视口坐标） */
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 纵向位置限制在视口内（d = 悬浮球直径） */
export function clampDockTop(topPx: number, d: number): number {
  return clamp(topPx, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - d - EDGE_MARGIN))
}

/** 横向限制在视口内（d = 悬浮球直径） */
function clampX(x: number, d: number): number {
  return clamp(x, 0, Math.max(0, window.innerWidth - d))
}

/** 把位置夹回视口内（自由模式） */
export function clampBallPos(pos: BallPos, d: number): BallPos {
  return { x: clampX(pos.x, d), y: clampDockTop(pos.y, d) }
}

/** 吸边模式：按圆心归到最近一侧，返回贴边位置（d = 悬浮球直径） */
export function snapToEdge(pos: BallPos, d: number): BallPos {
  const c = clampBallPos(pos, d)
  const centerX = c.x + d / 2
  const side = centerX <= window.innerWidth / 2 ? 'left' : 'right'
  return { x: side === 'left' ? 0 : Math.max(0, window.innerWidth - d), y: c.y }
}

/** 根据形状/大小/图片计算球的外观样式（几何 + 背景），无图片时按预设填充 */
function buildBallStyle(shape: BallShape, d: number, image?: string | null): CSSProperties {
  const radius = shape === 'circle' ? '50%' : `${Math.round(d * 0.28)}px`
  const base: CSSProperties = { width: d, height: d, borderRadius: radius }
  if (image) {
    return {
      ...base,
      // 垫一层背景色：避免透明角/资源加载失败时露出页面，也让透明 logo 不至于"整个球透明"
      backgroundImage: `url("${image}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundColor: 'var(--tk-card)',
    }
  }
  // 无自定义图片：球面显示所选内置 logo（现为 emoji 占位），垫一层中性底让 logo 清晰可见
  return { ...base, background: 'var(--tk-card)', color: 'var(--tk-foreground)' }
}

interface DownState {
  startPX: number
  startPY: number
  moved: boolean
  active: boolean
}

interface FloatingBallProps {
  pos: BallPos
  /** 是否吸边：true 贴靠左右（含半隐）；false 可停留在任意位置 */
  snap: boolean
  /** 形状：圆形 / 带圆角方形 */
  shape?: BallShape
  /** 大小档位 */
  size?: BallSize
  /** 预设样式（无自定义图片时） */
  preset?: BallPreset
  /** 自定义图片（base64 data URL） */
  image?: string | null
  /** 拖拽结束后（贴边/落定）回调 */
  onDrop: (pos: BallPos) => void
  /** 轻点（未拖动）回调 */
  onToggle: () => void
}

/**
 * 悬浮触发器（悬浮球，形状/大小/样式可配置）：
 * - 吸边模式：贴靠左右，鼠标移开只露一半、悬停完整滑出；拖动松手按最近一侧贴回。
 * - 自由模式：可拖到任意位置并停留，始终完整显示。
 * - 轻点（未位移）不产生定位变化，避免点击抽动。
 */
export default function FloatingBall({
  pos,
  snap,
  shape = 'circle',
  size = 'md',
  preset = 'primary',
  image,
  onDrop,
  onToggle,
}: FloatingBallProps) {
  const { t } = useTranslation()
  const d = BALL_SIZE_PX[size]
  const r = d / 2
  const presetOption = BALL_PRESET_OPTIONS.find((o) => o.value === preset)
  const presetLogo = presetOption?.icon ?? '🔵'
  // 展示图：优先自定义图片，否则用预设 logo 的图片（如有）；都没有则显示 emoji 占位
  const displayImage = image ?? (presetOption?.image ? ballAssetUrl(presetOption.image) : null)
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
    const down = downRef.current
    if (!down?.active) return
    const dx = e.clientX - down.startPX
    const dy = e.clientY - down.startPY

    // 未超过阈值前保持原样，轻点=点击，绝不重新定位（消除抽动）
    if (!down.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      down.moved = true
    }

    // 拖动：整圆以指针为中心跟随（始终完整显示，不越出视口）
    const nextX = clampX(e.clientX - r, d)
    const nextY = clampDockTop(e.clientY - r, d)
    lastXY.current = { x: nextX, y: nextY }
    setFloatXY(lastXY.current)
    setHovered(true)
  }

  function endDrag() {
    const down = downRef.current
    if (!down?.active) return
    down.active = false
    downRef.current = null
    setFloatXY(null)

    if (down.moved) {
      onDrop(snap ? snapToEdge(lastXY.current, d) : clampBallPos(lastXY.current, d))
    } else {
      onToggle()
    }
  }

  const visible = hovered || floatXY != null
  const side = pos.x + r <= window.innerWidth / 2 ? 'left' : 'right'
  // 自由模式/拖拽中：球要盖在网页内抽屉之上，否则抽屉打开后会挡住球，而球是唯一触发器会点不到。
  const aboveDrawer = floatXY != null || !snap

  const geo = buildBallStyle(shape, d, displayImage)
  let style: CSSProperties = aboveDrawer ? { zIndex: Z_ABOVE_DRAWER, ...geo } : { ...geo }
  if (floatXY) {
    // 拖动：整圆跟随指针
    style = { ...style, left: floatXY.x, top: floatXY.y, transition: 'none' }
  } else if (!snap) {
    // 自由模式：任意位置，始终完整显示
    style = { ...style, left: pos.x, top: pos.y }
  } else {
    // 吸边模式：未悬停时只露一半，沿边缘向内收 50% 宽度
    const translate = visible
      ? 'translateX(0)'
      : side === 'left'
        ? 'translateX(-50%)'
        : 'translateX(50%)'
    style =
      side === 'left'
        ? { ...style, left: 0, top: pos.y, transform: translate, transition: 'transform 0.3s ease' }
        : {
            ...style,
            right: 0,
            top: pos.y,
            transform: translate,
            transition: 'transform 0.3s ease',
          }
  }

  return (
    <div
      role='button'
      aria-label={t('ball.ariaOpen')}
      className={`tek__dock${floatXY ? ' tek__dock--drag' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {!displayImage && (
        <span className='tek__dock-logo' style={{ fontSize: Math.round(d * 0.5) }}>
          {presetLogo}
        </span>
      )}
    </div>
  )
}
