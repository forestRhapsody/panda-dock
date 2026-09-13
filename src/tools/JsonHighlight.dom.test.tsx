// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import JsonHighlight from './JsonHighlight'

/**
 * JsonHighlight 是「只读结果区」的渲染底器：它把一段文本切分成带类名的 span，
 * 再由 tools.css 上色。这里断言的是**真实生成的高亮 DOM**（token 分段 + 类名 + 文本无损），
 * 而不是「渲染成功」——上色类名写错在页面上的表现就是整块 JSON 变黑白，肉眼很难发现。
 *
 * 注意：它只做词法切分，不做 JSON 合法性校验（校验在 json.ts / formatJson）；
 * 因此「非法 JSON 降级为纯文本」在这里表现为「不抛错 + 原文一字不差地显示」，
 * 不存在额外的降级分支（见下方对应的用例说明）。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

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
})

/** 渲染并返回 pre 元素（每次 render 都重新查询，避免拿到上一轮的旧节点） */
function render(text: string, props: Record<string, unknown> = {}): HTMLPreElement {
  act(() => {
    root.render(<JsonHighlight text={text} {...props} />)
  })
  const pre = container.querySelector('pre')
  if (!pre) throw new Error('未渲染出 pre.tw-json-hl')
  return pre as HTMLPreElement
}

/** 假的 ResizeObserver：捕获回调与观察目标，用于断言「宽度变化后重测」 */
function stubResizeObserver() {
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
  return {
    observed,
    /** 模拟容器宽度变化 */
    resize(width: number) {
      act(() => {
        callbacks[0]?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
      })
    },
  }
}

/** 取出匹配选择器的所有元素文本（高亮 token 都是单层 span，textContent 即 token 原文） */
function texts(selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((el) => el.textContent ?? '')
}

const codeText = () => container.querySelector('code')?.textContent ?? ''

/** 行号模式下 code 的 textContent 会混入行号，这里只取正文列并按行拼回原文 */
const lineBodyText = () =>
  [...container.querySelectorAll('.tw-json-hl__content')]
    .map((el) => (el.textContent === '\u00A0' ? '' : (el.textContent ?? '')))
    .join('\n')

describe('JsonHighlight 的 token 分类', () => {
  it('key / string / number / boolean / null / 标点分别落到不同的 span 类名', () => {
    render('{"name":"panda","age":3,"ok":true,"none":null}')

    // key 与 string 虽然都是引号串，但必须分到不同类名，否则整块 JSON 只有一种颜色
    expect(texts('.jhl-key')).toEqual(['"name"', '"age"', '"ok"', '"none"'])
    expect(texts('.jhl-str')).toEqual(['"panda"'])
    expect(texts('.jhl-num')).toEqual(['3'])
    expect(texts('.jhl-kw')).toEqual(['true', 'null'])
    // 9 个结构性字符：{ : , : , : , : }
    expect(texts('.jhl-punc')).toEqual(['{', ':', ',', ':', ',', ':', ',', ':', '}'])
  })

  it('引号后跟冒号（中间可有空白）才判为 key，数组里的同形字符串仍是 string', () => {
    render('{"a"  : "b", "c":"d"}')
    expect(texts('.jhl-key')).toEqual(['"a"', '"c"'])
    expect(texts('.jhl-str')).toEqual(['"b"', '"d"'])

    // 字符串值内部含冒号，但后面是 ] 而不是 :，绝不能误判成 key
    render('["k:v"]')
    expect(texts('.jhl-key')).toEqual([])
    expect(texts('.jhl-str')).toEqual(['"k:v"'])
  })

  it('转义字符（\\" 与 \\\\）不会提前结束字符串 token', () => {
    render('{"k":"a\\"b","p":"x\\\\","n":1}')

    // 原始文本里是 "a\"b"，转义引号必须留在同一个 token 内
    expect(texts('.jhl-str')).toEqual(['"a\\"b"', '"x\\\\"'])
    // 转义没有破坏后续字段的 key 判定
    expect(texts('.jhl-key')).toEqual(['"k"', '"p"', '"n"'])
    expect(texts('.jhl-num')).toEqual(['1'])
  })

  it('Unicode 转义与多字节字符原样保留在 string token 中', () => {
    const text = '{"中":"文\\u4e2d","emoji":"🐼"}'
    render(text)
    expect(texts('.jhl-key')).toEqual(['"中"', '"emoji"'])
    expect(texts('.jhl-str')).toEqual(['"文\\u4e2d"', '"🐼"'])
    // 转义序列不被解码：展示层保持用户原始文本
    expect(codeText()).toBe(text)
  })

  it('嵌套对象 / 数组：各层 key 都是 key，括号与冒号逗号都是标点', () => {
    render('{"a":[1,{"b":[true,null]}]}')

    expect(texts('.jhl-key')).toEqual(['"a"', '"b"'])
    expect(texts('.jhl-num')).toEqual(['1'])
    expect(texts('.jhl-kw')).toEqual(['true', 'null'])
    // { : [ , { : [ , ] } ] } 共 12 个结构字符
    expect(texts('.jhl-punc')).toEqual(['{', ':', '[', ',', '{', ':', '[', ',', ']', '}', ']', '}'])
  })

  it('数字 token 整体切分（负数 / 小数 / 指数），不会在 e / . / - 处断开', () => {
    render('[0,-1,1.5,2e10,-3.5E-2]')
    expect(texts('.jhl-num')).toEqual(['0', '-1', '1.5', '2e10', '-3.5E-2'])
  })
})

describe('JsonHighlight 的文本无损与安全', () => {
  it('带缩进换行的格式化 JSON，渲染文本与原始输入逐字一致', () => {
    const text = JSON.stringify({ a: [1, 2, { b: '中文' }], c: null }, null, 2)
    render(text)
    expect(codeText()).toBe(text)
    expect(JSON.parse(codeText())).toEqual({ a: [1, 2, { b: '中文' }], c: null })
  })

  it('非法 JSON 不抛错、按词法原样输出（合法性校验不属于本组件）', () => {
    // 源码只做 while 扫描，不调用 JSON.parse；所以这里不存在「解析失败 → 降级」的分支，
    // 真实可观察行为就是：不抛异常，且输入一个字符都不丢。
    for (const bad of ['{oops', '{"a":}', '[1,2', 'undefined', '{"a" 1}']) {
      expect(() => render(bad)).not.toThrow()
      expect(codeText()).toBe(bad)
    }
  })

  it('HTML 特殊字符被转义为文本，不会注入 script / img 标签', () => {
    const text = '{"a":"<script>alert(1)</script>","b":"<img src=x onerror=alert(2)>"}'
    render(text)

    // 安全断言：原文完整保留为文本，但 DOM 里绝不能出现真正的 script / img 节点
    expect(codeText()).toBe(text)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('<script')
    expect(container.innerHTML).not.toContain('<img')
    // 转义后应能在 innerHTML 中看到实体
    expect(container.innerHTML).toContain('&lt;script&gt;')
    // 这些字符本身仍应被切进 string token（而不是当成标签丢掉）
    expect(texts('.jhl-str')).toEqual([
      '"<script>alert(1)</script>"',
      '"<img src=x onerror=alert(2)>"',
    ])
  })

  it('空串展示占位符，自定义 placeholder 能覆盖 i18n 默认值', () => {
    render('')
    const empty = container.querySelector('.tw-json-hl__empty')
    expect(empty).not.toBeNull()
    expect(empty?.textContent).toBe(i18n.t('tool.json.resultPlaceholder'))
    // 空串时不应生成任何 token span
    expect(
      container.querySelectorAll('.jhl-key, .jhl-str, .jhl-num, .jhl-kw, .jhl-punc'),
    ).toHaveLength(0)

    render('', { placeholder: '暂无结果' })
    expect(container.querySelector('.tw-json-hl__empty')?.textContent).toBe('暂无结果')
  })

  it('仅空白字符时按内容渲染（不显示占位符）——边界行为如实记录', () => {
    render(' ')
    expect(container.querySelector('.tw-json-hl__empty')).toBeNull()
    expect(codeText()).toBe(' ')
  })

  it('超大 JSON 不炸，token 数与 key 数一致', () => {
    const obj: Record<string, number> = {}
    for (let i = 0; i < 600; i++) obj[`k${i}`] = i
    const text = JSON.stringify(obj)

    expect(text.length).toBeGreaterThan(6000)
    expect(() => render(text)).not.toThrow()
    expect(texts('.jhl-key')).toHaveLength(600)
    expect(codeText()).toBe(text)
  })
})

describe('JsonHighlight 的行号与外观透传', () => {
  it('showLineNumbers 时按行拆分，空行用不换行空格撑高', () => {
    const pre = render('{\n\n  "a": 1\n}', { showLineNumbers: true })

    expect(pre.className).toContain('tw-json-hl--numbered')
    // 4 行：{ / 空行 /   "a": 1 / }
    expect(texts('.tw-json-hl__ln')).toEqual(['1', '2', '3', '4'])
    const contents = texts('.tw-json-hl__content')
    expect(contents).toHaveLength(4)
    expect(contents[1]).toBe('\u00A0')
    expect(contents[2]).toBe('  "a": 1')
    // 行号只是装饰：正文列拼回来必须与输入逐字一致（空行对应的 nbsp 还原为换行）
    expect(lineBodyText()).toBe('{\n\n  "a": 1\n}')
  })

  it('默认不展示行号', () => {
    const pre = render('{\n  "a": 1\n}')
    expect(pre.className).not.toContain('tw-json-hl--numbered')
    expect(container.querySelectorAll('.tw-json-hl__line')).toHaveLength(0)
  })

  it('跨行字符串在行号模式下会被拆成每行一个同类名 span', () => {
    render('"line1\nline2"', { showLineNumbers: true })
    expect(texts('.jhl-str')).toEqual(['"line1', 'line2"'])
    expect(container.querySelectorAll('.tw-json-hl__line')).toHaveLength(2)
  })

  it('className 透传、fill 追加修饰类、maxHeight 写入 style（happy-dom 无布局）', () => {
    const pre = render('{"a":1}', { className: 'my-cls' })
    expect(pre.className).toContain('tw-json-hl')
    expect(pre.className).toContain('my-cls')

    // happy-dom 没有排版引擎：scrollHeight 恒为 0，所以这里只能断言「计算后写进 style 的结果」
    // （height=min(0,360)=0px、overflowY 只有超过上限才 auto），真实像素高度需浏览器实测。
    expect(pre.style.height).toBe('0px')
    expect(pre.style.overflowY).toBe('hidden')
    expect(pre.style.maxHeight).toBe('')

    const fillPre = render('{"a":1}', { fill: true })
    expect(fillPre.className).toContain('tw-json-hl--fill')
    // fill 模式交给父级弹性布局决定高度，组件只负责开内部滚动
    expect(fillPre.style.height).toBe('')
    expect(fillPre.style.overflowY).toBe('auto')

    render('{"a":1}', { maxHeight: 120 })
    const pre2 = container.querySelector('pre') as HTMLPreElement
    expect(pre2.style.height).toBe('0px')
    expect(pre2.style.overflowY).toBe('hidden')
  })

  it('文本内容发生变化时，scrollTop 与 scrollLeft 自动重置到顶部 (0, 0)', () => {
    const pre = render('{"first": 1}')
    pre.scrollTop = 150
    pre.scrollLeft = 80
    expect(pre.scrollTop).toBe(150)
    expect(pre.scrollLeft).toBe(80)

    render('{"second": 2}')
    expect(pre.scrollTop).toBe(0)
    expect(pre.scrollLeft).toBe(0)
  })
})

describe('JsonHighlight 的宽度变化重测', () => {
  it('宽度变化后按新折行结果重测；宽度不变则不重复测量', () => {
    const ro = stubResizeObserver()
    const pre = render('{\n  "a": 1\n}')
    expect(ro.observed).toEqual([pre])

    Object.defineProperty(pre, 'scrollHeight', { configurable: true, value: 400 })
    ro.resize(520)
    expect(pre.style.height).toBe('360px')

    Object.defineProperty(pre, 'scrollHeight', { configurable: true, value: 100 })
    ro.resize(520)
    expect(pre.style.height).toBe('360px')

    ro.resize(300)
    expect(pre.style.height).toBe('100px')

    vi.unstubAllGlobals()
  })
})
