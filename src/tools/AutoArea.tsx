import type { RefObject, TextareaHTMLAttributes } from 'react'

import { useAutoHeight } from './useAutoHeight'

interface AutoAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string
  /** 最大高度（px），内容超过后内部滚动。默认 360 */
  maxHeight?: number
  /** 允许外部获取底层 textarea DOM 实例（如一键清空后聚焦） */
  areaRef?: RefObject<HTMLTextAreaElement | null>
}

/**
 * 自适应高度的 textarea：高度按内容撑开（min-height 由 CSS 决定），
 * 封顶 maxHeight 后内部滚动。用于「解析结果」这类只读多行输出。
 *
 * 测量（含宽度变化重测、paint 前撑开避免父级测到过矮高度）统一走 useAutoHeight。
 */
export default function AutoArea({
  value,
  maxHeight = 360,
  className,
  onChange,
  areaRef,
  ...rest
}: AutoAreaProps) {
  const ref = useAutoHeight<HTMLTextAreaElement>({
    value,
    maxHeight,
    // 加一点容错余量，避免因最后一行舍入 / descender 出现多余滚动条
    extra: 12,
    externalRef: areaRef,
  })

  return <textarea ref={ref} className={className} value={value} onChange={onChange} {...rest} />
}
