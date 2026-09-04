import { useLayoutEffect, useRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

interface AutoAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string
  /** 最大高度（px），内容超过后内部滚动。默认 360 */
  maxHeight?: number
}

/**
 * 自适应高度的 textarea：高度按内容撑开（min-height 由 CSS 决定），
 * 封顶 maxHeight 后内部滚动。用于「解析结果」这类只读多行输出。
 */
export default function AutoArea({
  value,
  maxHeight = 360,
  className,
  onChange,
  ...rest
}: AutoAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // 用 useLayoutEffect：在 paint 前就把高度撑开，避免父级（悬浮面板）在测量面板高度时
  // 拿到"未撑开"的过矮高度，导致贴边打开时位置/翻转判断错误。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // 加一点容错余量，避免因最后一行舍入/descender 出现多余滚动条
    const h = Math.min(el.scrollHeight + 12, maxHeight)
    el.style.height = `${h}px`
    // 内容超出上限时内部滚动，否则隐藏滚动条
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, maxHeight])

  return <textarea ref={ref} className={className} value={value} onChange={onChange} {...rest} />
}
