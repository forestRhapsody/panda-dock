import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'

import { createPortal } from 'react-dom'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'
export type TooltipAlign = 'start' | 'center' | 'end'

export interface TooltipProps {
  /** 气泡展示内容。为 null/undefined/空时直接渲染子元素，不挂载气泡 */
  content: ReactNode
  /** 触发目标（通常是单个按钮或可聚焦元素） */
  children: ReactNode
  /** 弹出方位，默认 'top' */
  side?: TooltipSide
  /** 对齐方式，默认 'center' */
  align?: TooltipAlign
  /** 气泡与目标元素的间隙（px），默认 6 */
  sideOffset?: number
  /** 悬停触发延迟（ms），默认 150 */
  delayDuration?: number
  /** 是否禁用气泡展示 */
  disabled?: boolean
  /** 附加到气泡上的类名 */
  contentClassName?: string
}

interface Position {
  top: number
  left: number
  actualSide: TooltipSide
}

/**
 * 现代 shadcn 风格轻量 Tooltip 气泡组件：
 *  - 质感：炭黑/珍珠白高对比微拟态反转配色、柔和阴影、12px 精致排版；
 *  - 避障：自动检测视口边界（上下翻转 + 水平防溢出贴边平移）；
 *  - 隔离：经 portal 渲染至 document.body 或 Content Script 的 ShadowRoot，绝不被 parent overflow 截断；
 *  - 无障碍：自动赋予 role="tooltip" 与 aria-describedby，支持 Escape 隐藏与键盘交互。
 */
export default function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  delayDuration = 150,
  disabled = false,
  contentClassName,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position>({ top: 0, left: 0, actualSide: side })
  /**
   * 是否已经拿到**有效**测量结果。
   * 初值 position 是 (0,0)，而 `calcPosition()` 开头 `if (!triggerRef.current) return`；
   * 只要有一次拿不到触发元素、或拿到的是 0×0 的**退化矩形**（节点已脱离文档 / 布局未就绪），
   * 交叉轴公式 `left + (width - tooltipW)/2` 会算出负数并被夹到 8px ——
   * 表现就是「tooltip 贴在屏幕最左侧、垂直位置却正常」。宁可先不显示，也不显示错位置。
   */
  const [positioned, setPositioned] = useState(false)

  const triggerRef = useRef<HTMLElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const id = useId()

  const shouldRender = !disabled && Boolean(content)

  const calcPosition = useCallback((): boolean => {
    if (!triggerRef.current) return false
    const triggerRect = triggerRef.current.getBoundingClientRect()
    // 退化矩形（0×0）：按它算出的位置会把气泡甩到视口左缘，直接判定为「本次无法定位」
    if (triggerRect.width === 0 && triggerRect.height === 0) return false
    const tooltipEl = tooltipRef.current
    const tooltipW = tooltipEl?.offsetWidth ?? 80
    const tooltipH = tooltipEl?.offsetHeight ?? 26

    const VIEWPORT_PAD = 8
    let targetSide = side

    // 1. 垂直/水平避障翻转检测
    if (side === 'top' && triggerRect.top - tooltipH - sideOffset < VIEWPORT_PAD) {
      if (window.innerHeight - triggerRect.bottom >= tooltipH + sideOffset) {
        targetSide = 'bottom'
      }
    } else if (
      side === 'bottom' &&
      triggerRect.bottom + tooltipH + sideOffset > window.innerHeight - VIEWPORT_PAD
    ) {
      if (triggerRect.top >= tooltipH + sideOffset) {
        targetSide = 'top'
      }
    } else if (side === 'left' && triggerRect.left - tooltipW - sideOffset < VIEWPORT_PAD) {
      if (window.innerWidth - triggerRect.right >= tooltipW + sideOffset) {
        targetSide = 'right'
      }
    } else if (
      side === 'right' &&
      triggerRect.right + tooltipW + sideOffset > window.innerWidth - VIEWPORT_PAD
    ) {
      if (triggerRect.left >= tooltipW + sideOffset) {
        targetSide = 'left'
      }
    }

    let top = 0
    let left = 0

    // 2. 主轴位置计算
    if (targetSide === 'top') {
      top = triggerRect.top - tooltipH - sideOffset
    } else if (targetSide === 'bottom') {
      top = triggerRect.bottom + sideOffset
    } else if (targetSide === 'left') {
      left = triggerRect.left - tooltipW - sideOffset
    } else if (targetSide === 'right') {
      left = triggerRect.right + sideOffset
    }

    // 3. 交叉轴位置与对齐
    if (targetSide === 'top' || targetSide === 'bottom') {
      if (align === 'start') {
        left = triggerRect.left
      } else if (align === 'end') {
        left = triggerRect.right - tooltipW
      } else {
        left = triggerRect.left + (triggerRect.width - tooltipW) / 2
      }
      // 水平防溢出夹紧
      left = Math.max(VIEWPORT_PAD, Math.min(left, window.innerWidth - tooltipW - VIEWPORT_PAD))
    } else {
      if (align === 'start') {
        top = triggerRect.top
      } else if (align === 'end') {
        top = triggerRect.bottom - tooltipH
      } else {
        top = triggerRect.top + (triggerRect.height - tooltipH) / 2
      }
      // 垂直防溢出夹紧
      top = Math.max(VIEWPORT_PAD, Math.min(top, window.innerHeight - tooltipH - VIEWPORT_PAD))
    }

    setPosition({
      top: Math.round(top),
      left: Math.round(left),
      actualSide: targetSide,
    })
    return true
  }, [align, side, sideOffset])

  function showTooltip() {
    if (!shouldRender) return
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      // 先置 open，具体位置由下方的 layoutEffect 在**绘制前**用真实尺寸测出来；
      // 未测到（positioned=false）时 portal 不渲染，因此不会闪出 (0,0)
      setOpen(true)
    }, delayDuration)
  }

  function hideTooltip() {
    window.clearTimeout(timerRef.current)
    setOpen(false)
    // 复位定位状态：下次显示必须重新测量，避免复用上一次的旧坐标
    setPositioned(false)
  }

  // 监听滚动与窗口尺寸变动实时同步位置
  useEffect(() => {
    if (!open) return
    const update = () => calcPosition()
    window.addEventListener('scroll', update, { passive: true, capture: true })
    window.addEventListener('resize', update, { passive: true })
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, calcPosition])

  // 按下 Escape 键立即收起气泡
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') hideTooltip()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // 气泡挂载后根据真实 DOM 宽度精确微调一次。
  // 依赖 positioned：positioned 从 false 变 true 后 portal 才挂载，这一轮再用真实元素测一次宽度。
  useLayoutEffect(() => {
    if (open) setPositioned(calcPosition())
  }, [open, positioned, calcPosition])

  // 卸载时清理定时器
  useEffect(() => {
    return () => window.clearTimeout(timerRef.current)
  }, [])

  // 如果不满足渲染条件，作为透传组件返回
  if (!shouldRender) {
    return <>{children}</>
  }

  // 为子元素注入事件与 ref
  const triggerHandlers = {
    onMouseEnter: (e: React.MouseEvent) => {
      showTooltip()
      if (isValidElement(children)) {
        const p = children.props as { onMouseEnter?: (e: React.MouseEvent) => void }
        p.onMouseEnter?.(e)
      }
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hideTooltip()
      if (isValidElement(children)) {
        const p = children.props as { onMouseLeave?: (e: React.MouseEvent) => void }
        p.onMouseLeave?.(e)
      }
    },
    onFocus: (e: React.FocusEvent) => {
      showTooltip()
      if (isValidElement(children)) {
        const p = children.props as { onFocus?: (e: React.FocusEvent) => void }
        p.onFocus?.(e)
      }
    },
    onBlur: (e: React.FocusEvent) => {
      hideTooltip()
      if (isValidElement(children)) {
        const p = children.props as { onBlur?: (e: React.FocusEvent) => void }
        p.onBlur?.(e)
      }
    },
    onPointerDown: (e: React.PointerEvent) => {
      hideTooltip()
      if (isValidElement(children)) {
        const p = children.props as { onPointerDown?: (e: React.PointerEvent) => void }
        p.onPointerDown?.(e)
      }
    },
  }

  let triggerElement: ReactNode
  if (isValidElement(children)) {
    const childEl = children as ReactElement<{
      ref?: React.Ref<HTMLElement>
      'aria-describedby'?: string
    }>
    triggerElement = cloneElement(childEl, {
      ...triggerHandlers,
      'aria-describedby': open ? id : undefined,
      ref: (node: HTMLElement | null) => {
        triggerRef.current = node
        // 保留子元素原有 ref
        const originalRef =
          (childEl.props as { ref?: unknown })?.ref ?? (childEl as { ref?: unknown }).ref
        if (typeof originalRef === 'function') {
          originalRef(node)
        } else if (originalRef && typeof originalRef === 'object') {
          ;(originalRef as { current: HTMLElement | null }).current = node
        }
      },
    })
  } else {
    triggerElement = (
      <span
        ref={(el) => {
          triggerRef.current = el
        }}
        aria-describedby={open ? id : undefined}
        {...triggerHandlers}
      >
        {children}
      </span>
    )
  }

  // 决定 portal 挂载目标（Shadow DOM 内部挂回 ShadowRoot，普通页面挂到 document.body）
  const rootNode = triggerRef.current?.getRootNode?.()
  const portalTarget: HTMLElement | ShadowRoot | null =
    rootNode && (rootNode as ShadowRoot).host
      ? (rootNode as ShadowRoot)
      : typeof document !== 'undefined'
        ? document.body
        : null

  const tooltipStyle: CSSProperties = {
    top: `${position.top}px`,
    left: `${position.left}px`,
  }

  const tooltipPortal =
    open && positioned && portalTarget
      ? createPortal(
          <div
            ref={tooltipRef}
            id={id}
            role='tooltip'
            data-side={position.actualSide}
            className={`pd-tooltip${contentClassName ? ` ${contentClassName}` : ''}`}
            style={tooltipStyle}
          >
            {content}
          </div>,
          portalTarget,
        )
      : null

  return (
    <>
      {triggerElement}
      {tooltipPortal}
    </>
  )
}
