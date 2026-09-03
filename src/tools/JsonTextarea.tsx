import { useEffect, useMemo, useRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

import { highlightJson } from './JsonHighlight'

interface JsonTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string
  /** 最大高度(px)，超出后内部滚动。默认 240 */
  maxHeight?: number
}

/**
 * 可编辑的 JSON 高亮输入框。
 * 实现：底层 `<pre>` 渲染彩色 JSON，上层 `<textarea>` 文字设为透明（保留光标与编辑），
 * 滚动同步；观感上是彩色 JSON 且可直接编辑。
 */
export default function JsonTextarea({
  value,
  maxHeight = 240,
  onChange,
  ...rest
}: JsonTextareaProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const nodes = useMemo(() => highlightJson(value), [value])

  // 自适应高度：按内容撑到 maxHeight 封顶
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const h = Math.min(ta.scrollHeight, maxHeight)
    ta.style.height = `${h}px`
  }, [value, maxHeight])

  // 滚动同步：textarea 滚动时同步高亮层
  function syncScroll() {
    const ta = taRef.current
    const pre = preRef.current
    if (!ta || !pre) return
    pre.scrollTop = ta.scrollTop
    pre.scrollLeft = ta.scrollLeft
  }

  return (
    <div className='json-editor'>
      <pre ref={preRef} className='json-editor__hl' aria-hidden='true'>
        <code>
          {nodes}
          {'\n'}
        </code>
      </pre>
      <textarea
        ref={taRef}
        className='json-editor__input'
        value={value}
        onChange={onChange}
        onScroll={syncScroll}
        onInput={syncScroll}
        spellCheck={false}
        {...rest}
      />
    </div>
  )
}
