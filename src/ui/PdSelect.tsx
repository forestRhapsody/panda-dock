/**
 * 自定义 Select 下拉组件（pd-select）
 * 完全抛弃原生 <select>，对齐 shadcn/ui 设计规范：
 *  - Trigger：button[role=combobox]，显示当前选中值 + 旋转 chevron
 *  - Dropdown：React Portal 渲染到 document.body（避免 overflow 裁剪），position:fixed 定位
 *  - 自动翻转：检测下方空间不足时改为向上展开
 *  - Items：左侧 check icon 标记选中，hover/focus accent 背景，disabled 状态
 *  - 键盘导航：↑/↓ 移动，Enter/Space 选中，Escape 关闭
 *  - 动画：fade + 微量位移入场
 *  - API 兼容：onChange 保持 (e: { target: { value: string } }) => void，
 *    子节点传 <option value="...">标签</option>（无需改现有调用方）
 */
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { createPortal } from 'react-dom'

import Icon from './Icon'
import Tooltip from './Tooltip'

// —— 类型 ——

interface OptionInfo {
  value: string
  label: string
  disabled?: boolean
}

interface PdSelectProps {
  value: string | number
  onChange: (e: { target: { value: string } }) => void
  children: React.ReactNode
  /** md = 标准控件高（Options 设置项），sm = 紧凑控件高（工具栏） */
  variant?: 'md' | 'sm'
  disabled?: boolean
  id?: string
  className?: string
  title?: string
  'aria-label'?: string
}

interface PopupPosition {
  top?: number
  bottom?: number
  left?: number
  right?: number
  minWidth: number
}

// —— 工具函数 ——

/** 从 children 中解析 <option> 元素，提取 value / label / disabled */
function parseOptions(children: React.ReactNode): OptionInfo[] {
  const opts: OptionInfo[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== 'option') return
    const p = child.props as {
      value?: string | number
      children?: React.ReactNode
      disabled?: boolean
    }
    opts.push({
      value: String(p.value ?? ''),
      label: String(p.children ?? ''),
      disabled: p.disabled,
    })
  })
  return opts
}

// —— 组件 ——

export default function PdSelect({
  value,
  onChange,
  children,
  variant = 'md',
  disabled = false,
  id,
  className,
  title,
  'aria-label': ariaLabel,
}: PdSelectProps) {
  const [open, setOpen] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [popupPos, setPopupPos] = useState<PopupPosition>({ left: 0, minWidth: 0 })
  /**
   * 位置是否已由**实测**校正过。
   * 初值 `popupPos.left = 0` 只在 `calcPosition()` 成功执行时才会被覆盖，
   * 一旦它提前 return（拿不到 trigger ref）或估算与实际布局有偏差，
   * 弹层就会先在 `left: 0`（屏幕最左侧）露一帧。挂载后先隐藏、实测校正完再显示。
   */
  const [popupReady, setPopupReady] = useState(false)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  const options = parseOptions(children)
  const strValue = String(value)
  const selectedIdx = options.findIndex((o) => o.value === strValue)
  const selectedLabel = selectedIdx >= 0 ? options[selectedIdx].label : ''

  // —— 位置计算 ——

  const calcPosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const GAP = 4
    const VIEWPORT_PAD = 8
    const spaceBelow = window.innerHeight - rect.bottom
    const estimatedH = Math.min(options.length * 34 + 8, 300)

    // 垂直方向：下方空间不足且上方空间更大时向上展开
    let top: number | undefined = undefined
    let bottom: number | undefined = undefined
    if (spaceBelow < estimatedH && rect.top > spaceBelow) {
      bottom = window.innerHeight - rect.top + GAP
    } else {
      top = rect.bottom + GAP
    }

    // 预估面板宽度：取触发按钮宽度与预估最小宽度（sm 104px，md 128px）的较大值
    const defaultMinW = variant === 'sm' ? 104 : 128
    const estimatedW = popupRef.current
      ? popupRef.current.getBoundingClientRect().width
      : Math.max(rect.width, defaultMinW)

    // 水平方向：检测右侧是否会溢出视口边界
    let left: number | undefined = rect.left
    let right: number | undefined = undefined

    if (rect.left + estimatedW > window.innerWidth - VIEWPORT_PAD) {
      // 若左对齐会超出右边界，改为右对齐到触发按钮右侧
      left = undefined
      right = Math.max(VIEWPORT_PAD, window.innerWidth - rect.right)
    } else {
      left = Math.max(VIEWPORT_PAD, rect.left)
      right = undefined
    }

    setPopupPos({
      top,
      bottom,
      left,
      right,
      minWidth: rect.width,
    })
  }, [options.length, variant])

  // —— 打开 ——

  function openDropdown() {
    if (disabled) return
    setPopupReady(false)
    calcPosition()
    setOpen(true)
    setFocusedIdx(selectedIdx >= 0 ? selectedIdx : 0)
  }

  function closeDropdown() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  // —— 选中 ——

  function selectValue(val: string) {
    onChange({ target: { value: val } })
    closeDropdown()
  }

  // —— 点击外部关闭 ——
  // 注意：用 composedPath 而不是 e.target。
  // 在 Content Script 的 Shadow DOM（悬浮球/网页内抽屉）里，事件越过 shadow 边界时
  // target 会被重定向为宿主元素，导致 contains() 判定失真：点选项会被当成「点外部」，
  // 表现为下拉「点不开/点了没反应」。composedPath() 返回包含 shadow 内部节点的完整路径。
  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target as Node]
      if (triggerRef.current && path.includes(triggerRef.current)) return
      if (popupRef.current && path.includes(popupRef.current)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open])

  // —— 滚动/Resize 重算位置 ——

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

  // —— 焦点项滚入视口 & 视口边界纠偏 ——

  useLayoutEffect(() => {
    if (!open || !popupRef.current) return
    const items = popupRef.current.querySelectorAll<HTMLElement>('[data-pds-item]')
    items[focusedIdx]?.scrollIntoView({ block: 'nearest' })

    // 真实 DOM 渲染后兜底校验：用**实测尺寸**把弹层夹在视口内 —— 左右两边都要夹。
    // 只夹右边界不够：右对齐分支用的是 `window.innerWidth - triggerRect.right`，
    // 一旦 `innerWidth` 与最终布局不一致（抽屉/侧边栏宽度变化、滚动条出现/消失导致视口宽度跳变），
    // 算出的 right 会把弹层推到左边界之外，表现为「下拉跑到屏幕最左侧」。
    const popupEl = popupRef.current
    const VIEWPORT_PAD = 8
    const rect = popupEl.getBoundingClientRect()
    const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - rect.width - VIEWPORT_PAD)
    const clampedLeft = Math.min(Math.max(rect.left, VIEWPORT_PAD), maxLeft)
    if (Math.abs(clampedLeft - rect.left) > 0.5) {
      // 通过 state 修正而不是直接改 DOM：避免与 React 的 style 出现两套真相
      setPopupPos((prev) => ({ ...prev, left: clampedLeft, right: undefined }))
    }
    setPopupReady(true)
  }, [focusedIdx, open, popupPos.top])

  // —— 键盘 ——

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    switch (e.key) {
      case 'Enter':
      case ' ':
        if (!open) {
          openDropdown()
          e.preventDefault()
          return
        }
        if (options[focusedIdx] && !options[focusedIdx].disabled) {
          selectValue(options[focusedIdx].value)
        }
        e.preventDefault()
        return
      case 'ArrowDown':
        e.preventDefault()
        if (!open) {
          openDropdown()
          return
        }
        setFocusedIdx((i) => {
          let next = i
          do {
            next = Math.min(next + 1, options.length - 1)
          } while (next < options.length - 1 && options[next].disabled)
          return next
        })
        return
      case 'ArrowUp':
        e.preventDefault()
        if (!open) {
          openDropdown()
          return
        }
        setFocusedIdx((i) => {
          let next = i
          do {
            next = Math.max(next - 1, 0)
          } while (next > 0 && options[next].disabled)
          return next
        })
        return
      case 'Escape':
        if (open) {
          setOpen(false)
          e.preventDefault()
        }
        return
      case 'Tab':
        if (open) setOpen(false)
        return
    }
  }

  // —— 渲染 ——

  const triggerCls = [
    'pd-select',
    variant === 'sm' && 'pd-select--sm',
    open && 'pd-select--open',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const isRightAligned = popupPos.right !== undefined
  const isBottomAligned = popupPos.bottom !== undefined

  const popupStyle: React.CSSProperties = {
    minWidth: popupPos.minWidth,
    ...(popupPos.left !== undefined ? { left: popupPos.left } : {}),
    ...(popupPos.right !== undefined ? { right: popupPos.right } : {}),
    ...(popupPos.top !== undefined ? { top: popupPos.top } : {}),
    ...(popupPos.bottom !== undefined ? { bottom: popupPos.bottom } : {}),
    transformOrigin: `${isBottomAligned ? 'bottom' : 'top'} ${isRightAligned ? 'right' : 'left'}`,
    // 实测校正完成前先隐藏：否则初始的 left:0 会以「弹层出现在屏幕最左侧」的形式闪出来
    ...(popupReady ? {} : { visibility: 'hidden' as const }),
  }

  // 选择渲染挂载点：
  //  - 正常扩展页面（Popup / Options / 侧边栏）里 trigger 的根节点是 document，直接 portal 到 body；
  //  - 在 Content Script 的 Shadow DOM（悬浮球/抽屉）里，trigger 的根节点是 ShadowRoot，
  //    必须 portal 回该 ShadowRoot —— 否则下拉会被渲染到宿主网页，脱离 shadow 的 CSS 变量与样式，
  //    既污染宿主页面（违反「样式只准进 Shadow DOM」），又因为丢失 position:fixed/背景而「看不到/点不开」。
  const rootNode = triggerRef.current?.getRootNode?.()
  const portalTarget: HTMLElement | ShadowRoot =
    rootNode && (rootNode as ShadowRoot).host ? (rootNode as ShadowRoot) : document.body

  const dropdown =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popupRef}
            role='listbox'
            aria-label={ariaLabel}
            className={['pd-select-popup', variant === 'sm' && 'pd-select-popup--sm']
              .filter(Boolean)
              .join(' ')}
            style={popupStyle}
            onMouseLeave={() => setFocusedIdx(selectedIdx >= 0 ? selectedIdx : 0)}
          >
            {options.map((opt, i) => (
              <div
                key={opt.value}
                data-pds-item
                role='option'
                aria-selected={opt.value === strValue}
                aria-disabled={opt.disabled}
                className={[
                  'pd-select-item',
                  i === focusedIdx && 'pd-select-item--focused',
                  opt.value === strValue && 'pd-select-item--selected',
                  opt.disabled && 'pd-select-item--disabled',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => !opt.disabled && setFocusedIdx(i)}
                onPointerDown={(e) => {
                  e.preventDefault()
                  if (!opt.disabled) selectValue(opt.value)
                }}
              >
                <span className='pd-select-item__check'>
                  {opt.value === strValue && <Icon name='check' size={13} />}
                </span>
                <span className='pd-select-item__label'>{opt.label}</span>
              </div>
            ))}
          </div>,
          portalTarget,
        )
      : null

  const triggerBtn = (
    <button
      ref={triggerRef}
      id={id}
      type='button'
      role='combobox'
      aria-expanded={open}
      aria-haspopup='listbox'
      aria-label={ariaLabel ?? selectedLabel}
      disabled={disabled}
      className={triggerCls}
      onClick={() => (open ? closeDropdown() : openDropdown())}
      onKeyDown={handleKeyDown}
    >
      <span className='pd-select__value'>
        {selectedLabel || <span className='pd-select__placeholder'>—</span>}
      </span>
      <span className='pd-select__arrow' aria-hidden>
        <Icon name='chevron-down' size={variant === 'sm' ? 12 : 14} />
      </span>
    </button>
  )

  return (
    <>
      {title ? (
        <Tooltip content={title} disabled={open || disabled}>
          {triggerBtn}
        </Tooltip>
      ) : (
        triggerBtn
      )}
      {dropdown}
    </>
  )
}
