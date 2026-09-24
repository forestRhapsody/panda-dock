import { useMemo, useRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

import { highlightJson } from './JsonHighlight'
import { useAutoHeight } from './useAutoHeight'
import { useTabIndent } from './useTabIndent'

interface JsonTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string
  /** 最大高度(px)，超出后内部滚动。默认 300 */
  maxHeight?: number
}

/**
 * 可编辑的 JSON 高亮输入框。
 * 实现：底层 `<pre>` 渲染彩色 JSON，上层 `<textarea>` 文字设为透明（保留光标与编辑），
 * 滚动同步；观感上是彩色 JSON 且可直接编辑。
 */
export default function JsonTextarea({
  value,
  maxHeight = 300,
  onChange,
  onKeyDown,
  ...rest
}: JsonTextareaProps) {
  // 高度自适应交给 useAutoHeight（含宽度变化重测）；此处不接管 overflowY，
  // 内容超出时仍由 textarea 自身默认滚动，保持既有行为
  const taRef = useAutoHeight<HTMLTextAreaElement>({
    value,
    maxHeight,
    // 加一点容错余量，避免因最后一行舍入/descender 出现多余滚动条
    extra: 12,
    manageOverflow: false,
  })
  const preRef = useRef<HTMLPreElement>(null)
  const nodes = useMemo(() => highlightJson(value), [value])
  const handleKeyDown = useTabIndent(onKeyDown)

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
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        onInput={syncScroll}
        spellCheck={false}
        {...rest}
      />
    </div>
  )
}
