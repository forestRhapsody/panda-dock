import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

/** JSON 语法着色：把合法 JSON 文本切分成带颜色类名的 span */
export function highlightJson(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const push = (cls: string | null, s: string) => {
    if (!s) return
    nodes.push(
      cls ? (
        <span key={nodes.length} className={cls}>
          {s}
        </span>
      ) : (
        s
      ),
    )
  }

  let i = 0
  const len = text.length
  while (i < len) {
    const ch = text[i]

    if (ch === '"') {
      // 读取一个完整字符串（处理转义），字符串后紧跟冒号视为属性名（key）
      let j = i + 1
      let escaped = false
      while (j < len) {
        const c = text[j]
        if (escaped) {
          escaped = false
          j++
          continue
        }
        if (c === '\\') {
          escaped = true
          j++
          continue
        }
        if (c === '"') {
          j++
          break
        }
        j++
      }
      const raw = text.slice(i, j) // 含引号
      let k = j
      while (k < len && /[ \t\r\n]/.test(text[k])) k++
      const isKey = text[k] === ':'
      push(isKey ? 'jhl-key' : 'jhl-str', raw)
      i = j
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1
      while (j < len && /[0-9eE+\-.]/.test(text[j])) j++
      push('jhl-num', text.slice(i, j))
      i = j
    } else if (text.startsWith('true', i)) {
      push('jhl-kw', 'true')
      i += 4
    } else if (text.startsWith('false', i)) {
      push('jhl-kw', 'false')
      i += 5
    } else if (text.startsWith('null', i)) {
      push('jhl-kw', 'null')
      i += 4
    } else if ('{}[]:,'.includes(ch)) {
      push('jhl-punc', ch)
      i++
    } else {
      push(null, ch) // 空白等
      i++
    }
  }
  return nodes
}

interface JsonHighlightProps {
  text: string
  /** 最大高度(px)，超出后内部滚动。默认 360 */
  maxHeight?: number
}

/** 带语法着色的只读 JSON 展示（自适应高度 + 封顶滚动） */
export default function JsonHighlight({ text, maxHeight = 360 }: JsonHighlightProps) {
  const ref = useRef<HTMLPreElement>(null)
  const nodes = useMemo(() => highlightJson(text), [text])

  // 用 useLayoutEffect：paint 前撑开高度，父级（悬浮面板）测量面板高度时能拿到正确块高
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const h = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${h}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [text, maxHeight])

  return (
    <pre ref={ref} className='tw-json-hl'>
      <code>{text ? nodes : <span className='tw-json-hl__empty'>结果会显示在这里…</span>}</code>
    </pre>
  )
}
