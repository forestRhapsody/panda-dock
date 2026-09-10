import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

import { useTranslation } from 'react-i18next'

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

/** 将高亮 token 列表按换行符拆分成行列表 */
function splitNodesIntoLines(nodes: ReactNode[]): ReactNode[][] {
  const lines: ReactNode[][] = [[]]

  const append = (node: ReactNode) => {
    lines[lines.length - 1].push(node)
  }

  const newLine = () => {
    lines.push([])
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (typeof node === 'string') {
      const parts = node.split('\n')
      for (let p = 0; p < parts.length; p++) {
        if (p > 0) newLine()
        if (parts[p]) append(parts[p])
      }
    } else if (node && typeof node === 'object' && 'props' in node) {
      const el = node as React.ReactElement<{ className?: string; children?: ReactNode }>
      const child = el.props.children
      if (typeof child === 'string') {
        const parts = child.split('\n')
        for (let p = 0; p < parts.length; p++) {
          if (p > 0) newLine()
          if (parts[p]) {
            append(
              <span key={`${i}-${lines.length}-${p}`} className={el.props.className}>
                {parts[p]}
              </span>,
            )
          }
        }
      } else {
        append(node)
      }
    } else {
      append(node)
    }
  }

  return lines
}

interface JsonHighlightProps {
  text: string
  /** 最大高度(px)，超出后内部滚动。默认 360。当 fill 为 true 时被忽略 */
  maxHeight?: number
  /** 是否占满父级容器高度（用于分屏/弹性布局），启用内部纵向滚动 */
  fill?: boolean
  /** 占位提示文案，缺省走 i18n */
  placeholder?: string
  className?: string
  /** 是否展示行号（默认 false） */
  showLineNumbers?: boolean
}

/** 带语法着色的只读 JSON 展示（支持自适应高度 + 封顶滚动 或 满高分屏模式） */
export default function JsonHighlight({
  text,
  maxHeight = 360,
  fill = false,
  placeholder,
  className,
  showLineNumbers = false,
}: JsonHighlightProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLPreElement>(null)
  const nodes = useMemo(() => highlightJson(text), [text])
  const emptyText = placeholder ?? t('tool.json.resultPlaceholder')

  const lines = useMemo(() => {
    if (!text || !showLineNumbers) return null
    return splitNodesIntoLines(nodes)
  }, [text, showLineNumbers, nodes])

  const lnDigits = lines ? Math.max(2, String(lines.length).length) : 2
  const lnStyle = { width: `${lnDigits}ch` }

  // 用 useLayoutEffect：paint 前撑开高度，父级（悬浮面板）测量面板高度时能拿到正确块高
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (fill) {
      el.style.height = ''
      el.style.overflowY = 'auto'
      return
    }
    el.style.height = 'auto'
    const h = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${h}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [text, maxHeight, fill])

  return (
    <pre
      ref={ref}
      className={`tw-json-hl${fill ? ' tw-json-hl--fill' : ''}${
        showLineNumbers && lines ? ' tw-json-hl--numbered' : ''
      }${className ? ` ${className}` : ''}`}
    >
      <code>
        {text ? (
          showLineNumbers && lines ? (
            lines.map((lineNodes, idx) => (
              <div key={idx} className='tw-json-hl__line'>
                <span className='tw-json-hl__ln' style={lnStyle} aria-hidden='true'>
                  {idx + 1}
                </span>
                <span className='tw-json-hl__content'>
                  {lineNodes.length > 0 ? lineNodes : '\u00A0'}
                </span>
              </div>
            ))
          ) : (
            nodes
          )
        ) : (
          <span className='tw-json-hl__empty'>{emptyText}</span>
        )}
      </code>
    </pre>
  )
}
