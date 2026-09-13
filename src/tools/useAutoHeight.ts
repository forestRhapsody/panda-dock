import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** 自适应高度的三种形态（语义见 `useAutoHeight` 的说明） */
export type AutoHeightMode =
  /** 内容撑满，到 maxHeight 封顶后改由元素自身滚动（普通 textarea / 高亮层） */
  | 'cap'
  /** 内容撑满且不封顶，由外层容器滚动；空内容交还 CSS（min-height） */
  | 'content'
  /** 完全不测量：高度由 CSS flex 撑满（fill 场景），只清掉历史内联高度与滚动限制 */
  | 'fill'

interface AutoHeightOptions<El extends HTMLElement> {
  /** 参与测量的内容：变化即重测 */
  value: string
  mode?: AutoHeightMode
  /** cap 模式的最大高度（px），默认 360 */
  maxHeight?: number
  /** cap 模式的容错余量（px），避免最后一行舍入 / descender 出现多余滚动条 */
  extra?: number
  /** cap 模式是否按「内容是否超限」切换 overflowY（默认 true） */
  manageOverflow?: boolean
  /** 测量前复位元素滚动位置（双层高亮层需要） */
  resetScroll?: boolean
  /** 外部需要拿到底层元素时传入（如一键清空后聚焦） */
  externalRef?: RefObject<El | null>
}

/**
 * 自适应高度：把「什么时候测量」与「怎么测量」收在一处，四个自适应控件共用
 * （AutoArea / JsonTextarea / JsonHighlight / HighlightArea）。
 *
 * 关键点：**宽度变化必须重测**。高度由 `scrollHeight` 决定，而 `scrollHeight` 依赖折行——
 * 同一段文本在窄容器（网页抽屉）与宽容器（原生侧边栏）、或拖拽抽屉宽度前后的折行数不同。
 * 只依赖 `value` 的话高度会停在旧宽度下的值：偏高留一片空白，偏矮会把内容裁掉
 * （cap 模式下还会因为 overflowY 仍是 hidden 而连滚动条都没有，属于「数据看不见」的硬伤）。
 * 这里用 ResizeObserver 盯元素宽度，宽度真的变了才重测，宽度不变不重复写布局。
 */
export function useAutoHeight<El extends HTMLElement>({
  value,
  mode = 'cap',
  maxHeight = 360,
  extra = 0,
  manageOverflow = true,
  resetScroll = false,
  externalRef,
}: AutoHeightOptions<El>): RefObject<El | null> {
  const ref = useRef<El>(null)

  const measure = useCallback(() => {
    const el = ref.current
    if (externalRef) {
      ;(externalRef as { current: El | null }).current = el
    }
    if (!el) return

    if (resetScroll) {
      el.scrollTop = 0
      el.scrollLeft = 0
    }

    if (mode === 'fill') {
      el.style.height = ''
      el.style.overflowY = 'auto'
      return
    }

    if (mode === 'content') {
      // 空内容交还 CSS（min-height）：否则任何一次「旧值的测量结果」都会让空输入框一直很高
      if (!value) {
        el.style.height = ''
        return
      }
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
      return
    }

    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + extra, maxHeight)}px`
    if (manageOverflow) {
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
    }
  }, [value, mode, maxHeight, extra, manageOverflow, resetScroll, externalRef])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  // 宽度变化 → 折行数变化 → 重新测量（首次回调若与挂载时宽度相同则跳过，避免无谓写入）
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastWidth = el.clientWidth
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth
      if (width === lastWidth) return
      lastWidth = width
      measure()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  return ref
}
