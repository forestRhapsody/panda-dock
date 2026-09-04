/**
 * 自定义 Select 下拉组件（tk-select）
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

// —— 类型 ——

interface OptionInfo {
  value: string
  label: string
  disabled?: boolean
}

interface TkSelectProps {
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
  left: number
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

export default function TkSelect({
  value,
  onChange,
  children,
  variant = 'md',
  disabled = false,
  id,
  className,
  title,
  'aria-label': ariaLabel,
}: TkSelectProps) {
  const [open, setOpen] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [popupPos, setPopupPos] = useState<PopupPosition>({ left: 0, minWidth: 0 })

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
    const spaceBelow = window.innerHeight - rect.bottom
    const estimatedH = Math.min(options.length * 34 + 8, 300)

    if (spaceBelow < estimatedH && rect.top > spaceBelow) {
      setPopupPos({
        bottom: window.innerHeight - rect.top + GAP,
        left: rect.left,
        minWidth: rect.width,
      })
    } else {
      setPopupPos({
        top: rect.bottom + GAP,
        left: rect.left,
        minWidth: rect.width,
      })
    }
  }, [options.length])

  // —— 打开 ——

  function openDropdown() {
    if (disabled) return
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

  // —— 焦点项滚入视口 ——

  useLayoutEffect(() => {
    if (!open || !popupRef.current) return
    const items = popupRef.current.querySelectorAll<HTMLElement>('[data-tks-item]')
    items[focusedIdx]?.scrollIntoView({ block: 'nearest' })
  }, [focusedIdx, open])

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
    'tk-select',
    variant === 'sm' && 'tk-select--sm',
    open && 'tk-select--open',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const popupStyle: React.CSSProperties = {
    left: popupPos.left,
    minWidth: popupPos.minWidth,
    ...(popupPos.top !== undefined ? { top: popupPos.top } : { bottom: popupPos.bottom }),
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
            className={['tk-select-popup', variant === 'sm' && 'tk-select-popup--sm']
              .filter(Boolean)
              .join(' ')}
            style={popupStyle}
            onMouseLeave={() => setFocusedIdx(selectedIdx >= 0 ? selectedIdx : 0)}
          >
            {options.map((opt, i) => (
              <div
                key={opt.value}
                data-tks-item
                role='option'
                aria-selected={opt.value === strValue}
                aria-disabled={opt.disabled}
                className={[
                  'tk-select-item',
                  i === focusedIdx && 'tk-select-item--focused',
                  opt.value === strValue && 'tk-select-item--selected',
                  opt.disabled && 'tk-select-item--disabled',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => !opt.disabled && setFocusedIdx(i)}
                onPointerDown={(e) => {
                  e.preventDefault()
                  if (!opt.disabled) selectValue(opt.value)
                }}
              >
                <span className='tk-select-item__check'>
                  {opt.value === strValue && <Icon name='check' size={13} />}
                </span>
                <span className='tk-select-item__label'>{opt.label}</span>
              </div>
            ))}
          </div>,
          portalTarget,
        )
      : null

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type='button'
        role='combobox'
        aria-expanded={open}
        aria-haspopup='listbox'
        aria-label={ariaLabel ?? selectedLabel}
        disabled={disabled}
        title={title}
        className={triggerCls}
        onClick={() => (open ? closeDropdown() : openDropdown())}
        onKeyDown={handleKeyDown}
      >
        <span className='tk-select__value'>
          {selectedLabel || <span className='tk-select__placeholder'>—</span>}
        </span>
        <span className='tk-select__arrow' aria-hidden>
          <Icon name='chevron-down' size={variant === 'sm' ? 12 : 14} />
        </span>
      </button>
      {dropdown}
    </>
  )
}
