import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { RefObject, TextareaHTMLAttributes } from 'react'

import type { DetectSourceMatch } from './detect'

interface HighlightAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string
  /** 匹配到的高亮区间列表（来自 detect 的 sourceMatches） */
  matches?: DetectSourceMatch[]
  /** 最大高度（px），内容超过后内部滚动。默认 360 */
  maxHeight?: number
  /** 允许外部获取底层 textarea DOM 实例（如一键清空后聚焦） */
  areaRef?: RefObject<HTMLTextAreaElement | null>
}

/**
 * 智能解析专用的高性能同轨双层高亮文本输入框：
 * - 统一滚动宿主（Unified Scroll Container）：由外层 .tw-area-wrapper 统一处理 maxHeight 与滚动条，
 *   彻底杜绝内层 textarea 产生原生滚动条导致的 17px 折行排版宽度偏差；
 * - CSS Grid 单槽同层对齐：pre 与 textarea 位于同一网格区域（1 / 1 / 2 / 2），共享完全相等的坐标系、宽度与字符折行点；
 * - 纯文字荧光笔涂层（box-decoration-break: clone）：多行自动折行时贴合字符笔触流动，不再呈现生硬错位的死方框；
 * - 文字与底色都由涂层绘制（与 JSON 高亮编辑器 `.json-editor__hl` 同一套模式）：可见文字来自
 *   `pre.tw-area-backdrop`，textarea 的文字透明、只保留光标 / 选区 / 输入法 —— 这样每个匹配项才能
 *   各自带「浅色底 + 深色字」的成对配色，明暗两套主题都看得清（令牌见 theme.css，对比度由
 *   theme.dom.test.ts 守住）；两层文本必须逐字一致，否则会出现错位重影；
 * - 激活联动滚动：切换解析结果时，自动将对应的高亮项平滑滚动至输入框可视居中区域。
 */
export default function HighlightArea({
  value,
  matches,
  maxHeight = 360,
  className = '',
  onChange,
  areaRef,
  ...rest
}: HighlightAreaProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)

  // 测量并撑开高度：textarea 自然跟随内容增高，推动外层 wrapper 滚动，内部绝不产生独立滚动条
  useLayoutEffect(() => {
    const el = taRef.current
    if (areaRef) {
      ;(areaRef as { current: HTMLTextAreaElement | null }).current = el
    }
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, areaRef])

  // 当激活的高亮项变更（如点击不同结果 Tab）时，自动将其平滑滚动到输入框的可视区域内
  useEffect(() => {
    // 若当前输入框正处于打字聚焦状态，不干扰用户的原生光标与滚动
    if (taRef.current?.matches(':focus')) {
      return
    }

    const wrapper = wrapperRef.current
    if (!wrapper || wrapper.clientHeight <= 0) return

    const markEl = wrapper.querySelector<HTMLElement>('.tw-area-mark')
    if (!markEl) return

    const wrapperRect = wrapper.getBoundingClientRect()
    const markRect = markEl.getBoundingClientRect()
    if (markRect.width <= 0 && markRect.height <= 0) return

    // markEl 相对于 wrapper 可滚动内容顶部的绝对坐标
    const relativeTop = markRect.top - wrapperRect.top + wrapper.scrollTop
    const relativeBottom = relativeTop + markRect.height

    const viewTop = wrapper.scrollTop
    const viewBottom = viewTop + wrapper.clientHeight

    const PADDING = 16
    // 判断是否已舒适地处于当前可视区域内（四周留出 16px 缓冲）
    const isVisible = relativeTop >= viewTop + PADDING && relativeBottom <= viewBottom - PADDING

    if (!isVisible) {
      const smooth = !isFirstRender.current
      isFirstRender.current = false

      let targetScrollTop: number
      // 若标记项高度较大（接近或超过容器可视高度），使顶部对齐并留出 PADDING
      if (markRect.height >= wrapper.clientHeight - PADDING * 2) {
        targetScrollTop = Math.max(0, relativeTop - PADDING)
      } else {
        // 否则将该项平滑居中展示，兼顾上下文视野
        targetScrollTop = Math.max(0, relativeTop - (wrapper.clientHeight - markRect.height) / 2)
      }

      const maxScroll = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight)
      const finalScrollTop = Math.min(targetScrollTop, maxScroll)

      if (Math.abs(finalScrollTop - wrapper.scrollTop) > 2) {
        wrapper.scrollTo({ top: finalScrollTop, behavior: smooth ? 'smooth' : 'auto' })
      }
    } else {
      isFirstRender.current = false
    }
  }, [matches])

  // 计算底层高亮节点：仅在 value 或 matches 变更时切片
  const backdropNodes = useMemo(() => {
    if (!matches || matches.length === 0 || !value) {
      return value
    }

    // 过滤出有效且位于范围内的匹配区间
    const validMatches = matches
      .filter((m) => m.startIndex >= 0 && m.endIndex <= value.length && m.startIndex < m.endIndex)
      .sort((a, b) => a.startIndex - b.startIndex)

    if (validMatches.length === 0) {
      return value
    }

    const nodes: React.ReactNode[] = []
    let lastIndex = 0

    validMatches.forEach((m, idx) => {
      if (m.startIndex > lastIndex) {
        nodes.push(value.slice(lastIndex, m.startIndex))
      }
      const highlighted = value.slice(Math.max(lastIndex, m.startIndex), m.endIndex)
      if (highlighted) {
        // 当前激活项用荧光标记；其余「待切换」项也用次级背景画出来 —— 否则用户看不出
        // 文本里还有别的匹配可以切过去。只靠背景色区分，不用边框/圆角（T24）
        const idle = m.active === false
        nodes.push(
          <mark key={`hl-${idx}`} className={`tw-area-mark${idle ? ' tw-area-mark--idle' : ''}`}>
            {highlighted}
          </mark>,
        )
      }
      lastIndex = Math.max(lastIndex, m.endIndex)
    })

    if (lastIndex < value.length) {
      nodes.push(value.slice(lastIndex))
    }

    return nodes
  }, [value, matches])

  return (
    <div ref={wrapperRef} className={`tw-area-wrapper ${className}`} style={{ maxHeight }}>
      <pre className='tw-area-backdrop' aria-hidden='true'>
        <code>
          {backdropNodes}
          {value.endsWith('\n') ? ' ' : ''}
        </code>
      </pre>
      <textarea
        ref={taRef}
        className='tw-area-input'
        value={value}
        onChange={onChange}
        spellCheck={false}
        {...rest}
      />
    </div>
  )
}
