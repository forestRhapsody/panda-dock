import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ToolTabsProps<T extends string> {
  items: { id: T; label: ReactNode }[]
  value: T
  onChange: (id: T) => void
  /** 供无障碍读屏（可选，同 role=tablist 的 aria-label） */
  'aria-label'?: string
  /** 附加 CSS 类名 */
  className?: string
}

/**
 * 工具能力内的子切换（Base64 编解码 / JSON 格式化压缩 / 存储 localStorage / 二维码生成解析 等共用）。
 * 统一 tab 外观与可访问性（role=tablist / role=tab / aria-selected），
 * 避免每个工具手写一套导致样式/结构漂移。类名走 tools.css 的 .tw-tabs / .tw-tabs__btn。
 */
export default function ToolTabs<T extends string>({
  items,
  value,
  onChange,
  'aria-label': ariaLabel,
  className = '',
}: ToolTabsProps<T>) {
  const navRef = useRef<HTMLDivElement>(null)
  const classes = ['tw-tabs', className].filter(Boolean).join(' ')

  useEffect(() => {
    const activeBtn = navRef.current?.querySelector<HTMLButtonElement>('.tw-tabs__btn--on')
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [value])

  return (
    <div ref={navRef} className={classes} role='tablist' aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type='button'
          role='tab'
          aria-selected={value === item.id}
          className={`tw-tabs__btn${value === item.id ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
