// @vitest-environment happy-dom
import { act, useState } from 'react'
import type { ChangeEvent, RefObject } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DetectSourceMatch } from './detect'
/**
 * HighlightArea 是「输入框 + 同轨高亮涂层」的双层结构：
 * textarea 负责输入/选区，pre.tw-area-backdrop 负责荧光笔涂层，两者必须共享完全相同的文本，
 * 否则会出现「输入的字与高亮的位置错位」——这是用户唯一能直接看到的功能性 bug。
 *
 * happy-dom 没有排版引擎：scrollHeight / clientHeight 恒为 0，getBoundingClientRect 全 0。
 * 因此「滚动同步」用**人造几何**（覆盖 clientHeight / rect）验证计算与 scrollTo 赋值逻辑，
 * 真实像素滚动仍以浏览器为准（见本文件末尾用例的说明）。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警
import HighlightArea from './HighlightArea'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

type AreaProps = {
  value: string
  matches?: DetectSourceMatch[]
  maxHeight?: number
  className?: string
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void
  areaRef?: RefObject<HTMLTextAreaElement | null>
  readOnly?: boolean
  placeholder?: string
  'aria-label'?: string
  maxLength?: number
  scrollTrigger?: number
}

/** 每次都用新数组，确保 matches 依赖变化能真正触发滚动 effect */
function render(props: AreaProps) {
  // 多数用例只关心展示与高亮。React 对「受控 textarea 但没给 onChange」会打印告警，
  // 这里补一个空回调降噪；回调本身的行为由专门用例覆盖。
  const withDefaults: AreaProps =
    props.onChange || props.readOnly ? props : { ...props, onChange: () => {} }
  act(() => {
    root.render(<HighlightArea {...withDefaults} />)
  })
}

function ta(): HTMLTextAreaElement {
  const el = container.querySelector('textarea')
  if (!el) throw new Error('未渲染出 textarea')
  return el
}

function wrapper(): HTMLDivElement {
  const el = container.querySelector('.tw-area-wrapper')
  if (!el) throw new Error('未渲染出 .tw-area-wrapper')
  return el as HTMLDivElement
}

const backdropText = () => container.querySelector('.tw-area-backdrop code')?.textContent ?? ''
const markTexts = () =>
  [...container.querySelectorAll('.tw-area-mark')].map((el) => el.textContent ?? '')

/** 模拟用户输入：走原生 value setter + input 事件，才能被 React 的 onChange 捕获 */
function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}

/** 人造 DOMRect：happy-dom 下真实 rect 全为 0，无法验证滚动计算 */
function rect(top: number, height: number, width = 40): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    width,
    left: 0,
    right: width,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as unknown as DOMRect
}

interface Layout {
  clientHeight: number
  scrollHeight: number
  scrollTop?: number
  markTop: number
  markHeight: number
}

/** 覆盖滚动宿主与高亮标记的几何信息，并记录 scrollTo 调用 */
function patchLayout(opts: Layout) {
  const w = wrapper()
  const mark = container.querySelector('.tw-area-mark')
  if (!mark) throw new Error('未渲染出 .tw-area-mark')

  Object.defineProperty(w, 'clientHeight', { configurable: true, get: () => opts.clientHeight })
  Object.defineProperty(w, 'scrollHeight', { configurable: true, get: () => opts.scrollHeight })
  w.scrollTop = opts.scrollTop ?? 0
  w.getBoundingClientRect = () => rect(0, opts.clientHeight)
  ;(mark as HTMLElement).getBoundingClientRect = () => rect(opts.markTop, opts.markHeight)

  const scrollTo = vi.fn()
  w.scrollTo = scrollTo as unknown as HTMLElement['scrollTo']
  return scrollTo
}

const match = (text: string, startIndex: number, endIndex: number, active = true) => ({
  text,
  startIndex,
  endIndex,
  active,
})

describe('HighlightArea 的高亮内容与 textarea 文本一致', () => {
  it('无 matches 时涂层原样显示 value，且不产生任何 mark', () => {
    render({ value: 'hello world' })
    expect(ta().value).toBe('hello world')
    expect(backdropText()).toBe('hello world')
    expect(markTexts()).toEqual([])
  })

  it('当前项用荧光标记、其余待切换项用次级背景标出（靠颜色区分，不靠边框/圆角）', () => {
    render({
      value: 'aaa BBB ccc',
      matches: [match('BBB', 4, 7, true), match('aaa', 0, 3, false)],
    })

    // 非激活项也要画出来（否则用户看不出还有别的匹配可切换），但用次级背景而非荧光色
    const marks = [...container.querySelectorAll<HTMLElement>('.tw-area-mark')]
    expect(marks.map((el) => el.textContent)).toEqual(['aaa', 'BBB'])
    expect(marks[0].classList.contains('tw-area-mark--idle')).toBe(true)
    expect(marks[1].classList.contains('tw-area-mark--idle')).toBe(false)
    // 涂层文本必须与 textarea 完全一致，否则会出现错位重影
    expect(backdropText()).toBe(ta().value)
    expect(backdropText()).toBe('aaa BBB ccc')
  })

  it('乱序传入的多个匹配按位置切片，文本不重复也不丢失', () => {
    render({
      value: 'one two three',
      matches: [match('three', 8, 13, true), match('one', 0, 3, false)],
    })

    // 两个匹配都会被画出来（一个荧光、一个次级背景），顺序按原文位置
    expect(markTexts()).toEqual(['one', 'three'])
    expect(backdropText()).toBe('one two three')
  })

  it('重叠区间按 lastIndex 推进切片，涂层文本仍与输入一致', () => {
    render({
      value: 'abcdef',
      matches: [match('abcd', 0, 4, true), match('cdef', 2, 6, true)],
    })

    // 第二个区间与前一个重叠：只能取未消费的后半段，否则文本会重复
    expect(markTexts()).toEqual(['abcd', 'ef'])
    expect(backdropText()).toBe('abcdef')
  })

  it('越界 / 零长匹配被过滤，原文本完整保留', () => {
    render({
      value: 'abc',
      matches: [match('x', -1, 2), match('y', 1, 10), match('z', 1, 1)],
    })

    expect(markTexts()).toEqual([])
    expect(backdropText()).toBe('abc')
  })

  it('matches 为空数组（或 value 为空）时等价纯文本', () => {
    render({ value: 'plain', matches: [] })
    expect(markTexts()).toEqual([])
    expect(backdropText()).toBe('plain')
  })
})

describe('HighlightArea 的文本边界', () => {
  it('空输入：textarea 与涂层都为空，不抛错', () => {
    render({ value: '' })
    expect(ta().value).toBe('')
    expect(backdropText()).toBe('')
    expect(markTexts()).toEqual([])
  })

  it('换行 / 制表符原样保留；末尾换行额外补一个空格撑高', () => {
    render({ value: 'a\tb\nc' })
    expect(ta().value).toBe('a\tb\nc')
    expect(backdropText()).toBe('a\tb\nc')

    // 末尾换行时 pre 会多补一个空格，用来让最后一行的空白行也占高度
    render({ value: 'a\n' })
    expect(ta().value).toBe('a\n')
    expect(backdropText()).toBe('a\n ')
  })

  it('超长单行不丢字符、不抛错', () => {
    const value = `${'x'.repeat(5000)}\n${'y'.repeat(5000)}`
    expect(() => render({ value })).not.toThrow()
    expect(ta().value).toBe(value)
    expect(backdropText()).toBe(value)
  })
})

describe('HighlightArea 的受控与透传行为', () => {
  it('输入触发受控 onChange，回调参数带新值', () => {
    // 受控组件在事件回调结束后会把 DOM value 复位成 prop，因此必须在回调内即时取值
    const received: string[] = []
    const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => received.push(e.target.value)
    render({ value: '', onChange })

    act(() => type(ta(), '新输入'))

    expect(received).toEqual(['新输入'])
  })

  it('readOnly 展示态：readOnly 透传到 textarea，外部 value 变化照常刷新涂层', () => {
    render({ value: '只读内容', readOnly: true })
    expect(ta().readOnly).toBe(true)

    render({ value: '更新后的只读内容', readOnly: true })
    expect(ta().value).toBe('更新后的只读内容')
    expect(backdropText()).toBe('更新后的只读内容')
  })

  it('原生属性透传：placeholder / aria-label / maxLength，spellCheck 恒为 false', () => {
    render({
      value: '',
      placeholder: '粘贴内容',
      'aria-label': '解析输入',
      maxLength: 120,
    })
    expect(ta().getAttribute('placeholder')).toBe('粘贴内容')
    expect(ta().getAttribute('aria-label')).toBe('解析输入')
    expect(ta().getAttribute('maxlength')).toBe('120')
    // spellCheck={false} 渲染成 spellcheck="false" 属性，避免浏览器对 JSON/密文弹拼写红线
    expect(ta().getAttribute('spellcheck')).toBe('false')
  })

  it('areaRef 暴露底层 textarea 实例', () => {
    const ref: RefObject<HTMLTextAreaElement | null> = { current: null }
    render({ value: 'abc', areaRef: ref })
    expect(ref.current).toBe(ta())
  })

  it('className 追加到滚动宿主，maxHeight 写入 wrapper 样式', () => {
    render({ value: 'abc', className: 'my-area', maxHeight: 200 })
    expect(wrapper().className).toBe('tw-area-wrapper my-area')
    expect(wrapper().style.maxHeight).toBe('200px')

    render({ value: 'abc' })
    expect(wrapper().className).toBe('tw-area-wrapper ')
    expect(wrapper().style.maxHeight).toBe('360px')
  })

  it('textarea 高度按 scrollHeight 撑开（happy-dom 无布局，只能断言写入逻辑）', () => {
    render({ value: '多行\n内容' })
    // happy-dom 的 scrollHeight 恒为 0，所以写入的是 '0px'；
    // 这里验证的是「height 由 scrollHeight 计算而来」这条链路被走到，真实高度需浏览器实测。
    expect(ta().style.height).toBe('0px')
  })

  it('空内容不写死内联高度：交还 CSS min-height（否则空输入框会停在旧值的高度上）', () => {
    render({ value: '' })
    expect(ta().style.height).toBe('')
  })

  it('容器宽度变化后重新测量：抽屉↔原生侧边栏 / 拖拽抽屉宽度时高度不会停在旧值', () => {
    const callbacks: ResizeObserverCallback[] = []
    const observed: Element[] = []
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        callbacks.push(cb)
      }
      observe(el: Element) {
        observed.push(el)
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    render({ value: '一行会被重新折行的文本' })
    // 观察 textarea 自身宽度即可（它 100% 跟随 wrapper 宽度）
    expect(observed).toEqual([ta()])

    // 新的宽度下折行数变了 → scrollHeight 变化 → 必须按新值重新撑开
    let scrollHeight = 250
    Object.defineProperty(ta(), 'scrollHeight', { get: () => scrollHeight, configurable: true })
    act(() => {
      callbacks[0]?.([{ contentRect: { width: 500 } } as ResizeObserverEntry], {} as ResizeObserver)
    })
    expect(ta().style.height).toBe('250px')

    // 宽度没变则不重复测量（避免无意义的布局写入）
    scrollHeight = 999
    act(() => {
      callbacks[0]?.([{ contentRect: { width: 500 } } as ResizeObserverEntry], {} as ResizeObserver)
    })
    expect(ta().style.height).toBe('250px')

    vi.unstubAllGlobals()
  })
})

describe('HighlightArea 的滚动同步（人造几何）', () => {
  it('happy-dom 无布局（clientHeight=0）时不调用 scrollTo —— 如实记录不可验证的部分', () => {
    render({ value: 'aaa BBB', matches: [match('BBB', 4, 7, true)] })
    const scrollTo = patchLayout({
      clientHeight: 0,
      scrollHeight: 1000,
      markTop: 600,
      markHeight: 20,
    })

    // 触发 effect 重跑：换一个新的 matches 数组
    render({ value: 'aaa BBB', matches: [match('BBB', 4, 7, true)] })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('高亮项不可见时滚动居中，首次用 auto（不打扰用户）', () => {
    render({ value: 'start X end', matches: [match('X', 6, 7, true)] })
    const scrollTo = patchLayout({
      clientHeight: 100,
      scrollHeight: 1000,
      markTop: 500,
      markHeight: 20,
    })

    render({ value: 'start X end', matches: [match('X', 6, 7, true)] })
    // relativeTop=500，居中偏移 (100-20)/2=40 → 460；首次 smooth=false → behavior 'auto'
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 460, behavior: 'auto' })

    // 第二次切换结果时改为平滑滚动
    render({ value: 'start X end', matches: [match('X', 6, 7, true)] })
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 460, behavior: 'smooth' })
  })

  it('高亮项高度接近容器时改为顶部对齐并留出 PADDING=16', () => {
    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    const scrollTo = patchLayout({
      clientHeight: 100,
      scrollHeight: 1000,
      markTop: 500,
      markHeight: 90,
    })

    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    // 90 >= 100 - 32 → 顶部对齐：max(0, 500-16)=484
    expect(scrollTo).toHaveBeenCalledWith({ top: 484, behavior: 'auto' })
  })

  it('滚动目标被 maxScroll 夹紧，不会滚过头', () => {
    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    const scrollTo = patchLayout({
      clientHeight: 100,
      scrollHeight: 200,
      markTop: 500,
      markHeight: 20,
    })

    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    // 目标 460 超过 maxScroll=100 → 夹到 100
    expect(scrollTo).toHaveBeenCalledWith({ top: 100, behavior: 'auto' })
  })

  it('高亮项已处于可视区（含 16px 缓冲）时不滚动', () => {
    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    const scrollTo = patchLayout({
      clientHeight: 100,
      scrollHeight: 1000,
      markTop: 50,
      markHeight: 20,
    })

    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('输入框聚焦打字时不打断：跳过滚动', () => {
    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    const scrollTo = patchLayout({
      clientHeight: 100,
      scrollHeight: 1000,
      markTop: 500,
      markHeight: 20,
    })
    vi.spyOn(ta(), 'matches').mockReturnValue(true)

    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('滚动量已在当前位置附近（差值 <=2px）时不触发 scrollTo', () => {
    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    const scrollTo = patchLayout({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 399,
      markTop: 500,
      markHeight: 20,
    })

    render({ value: 'X', matches: [match('X', 0, 1, true)] })
    // 理想目标 899-40=859，被 maxScroll=400 夹紧后为 400；与当前 399 只差 1px，
    // 属于「几乎没动」→ 不写 scrollTop，避免无意义的抖动（这就是 >2 阈值的作用）。
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('多匹配项切换时，准确找到激活项（.tw-area-mark--active）并滚动居中', () => {
    // 首次渲染：第 1 项激活
    render({
      value: 'first-match and then second-match',
      matches: [match('first-match', 0, 11, true), match('second-match', 21, 33, false)],
    })

    const w = wrapper()
    const marks = container.querySelectorAll<HTMLElement>('.tw-area-mark')
    expect(marks).toHaveLength(2)
    expect(marks[0].classList.contains('tw-area-mark--active')).toBe(true)
    expect(marks[1].classList.contains('tw-area-mark--idle')).toBe(true)

    Object.defineProperty(w, 'clientHeight', { configurable: true, get: () => 100 })
    Object.defineProperty(w, 'scrollHeight', { configurable: true, get: () => 1000 })
    w.scrollTop = 0
    w.getBoundingClientRect = () => rect(0, 100)
    // 模拟 marks[0] 在顶部舒适区（30px），marks[1] 在下方 600px 处
    marks[0].getBoundingClientRect = () => rect(30, 20)
    marks[1].getBoundingClientRect = () => rect(600, 20)

    const scrollTo = vi.fn()
    w.scrollTo = scrollTo as unknown as HTMLElement['scrollTo']

    // 重新渲染一次：第 1 项在可视范围内，消耗掉 isFirstRender 且不触发滚动
    render({
      value: 'first-match and then second-match',
      matches: [match('first-match', 0, 11, true), match('second-match', 21, 33, false)],
    })
    expect(scrollTo).not.toHaveBeenCalled()

    // 切换激活项到第 2 项（second-match）
    render({
      value: 'first-match and then second-match',
      matches: [match('first-match', 0, 11, false), match('second-match', 21, 33, true)],
    })

    // 必须滚动到第 2 个匹配项（top: 600 - (100-20)/2 = 560），而不是停留在第 1 个匹配项（0px）
    expect(scrollTo).toHaveBeenCalledWith({ top: 560, behavior: 'smooth' })
  })

  it('scrollTrigger 变化时，即使 matches 与 value 未变，移出视口后也能重新触发平滑滚动', () => {
    const matches = [match('match', 6, 11, true)]
    render({ value: 'hello match', matches, scrollTrigger: 0 })

    const w = wrapper()
    const mark = container.querySelector<HTMLElement>('.tw-area-mark--active')!
    expect(mark).not.toBeNull()

    Object.defineProperty(w, 'clientHeight', { configurable: true, get: () => 100 })
    Object.defineProperty(w, 'scrollHeight', { configurable: true, get: () => 1000 })
    w.scrollTop = 0
    w.getBoundingClientRect = () => rect(0, 100)
    mark.getBoundingClientRect = () => rect(30, 20)

    const scrollTo = vi.fn()
    w.scrollTo = scrollTo as unknown as HTMLElement['scrollTo']

    // 消耗首挂载
    render({ value: 'hello match', matches, scrollTrigger: 0 })
    expect(scrollTo).not.toHaveBeenCalled()

    // 模拟用户手动向下滚动了输入框（scrollTop = 500），高亮项移出视口
    w.scrollTop = 500
    mark.getBoundingClientRect = () => rect(-470, 20)

    // 用户再次点击同一个激活的 Tab，触发 scrollTrigger 递增
    render({ value: 'hello match', matches, scrollTrigger: 1 })

    // 此时应当把该激活项重新滚回居中（relativeTop=30，居中 targetScrollTop = max(0, 30 - 40) = 0）
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })
})

describe('HighlightArea 的 Tab 缩进', () => {
  it('Tab 缩进：受控值更新，涂层与输入层保持同源', () => {
    function Harness() {
      const [value, setValue] = useState('{\n"a": 1\n}')
      return <HighlightArea value={value} onChange={(e) => setValue(e.target.value)} />
    }
    act(() => {
      root.render(<Harness />)
    })

    const el = ta()
    act(() => el.setSelectionRange(0, 0))
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => {
      el.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(el.value).toBe('  {\n"a": 1\n}')
    // 两层文本必须逐字一致，否则会出现错位重影
    expect(backdropText()).toContain('  {')
  })
})
