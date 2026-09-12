// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { copyText } from '@/utils/clipboard'

import type { DetectBlock, DetectField, DetectItem, DetectResult } from './detect'
import DetectResultView from './DetectResultView'
import type { DetectResultViewProps } from './DetectResultView'
import { toolForDetectKind } from './handoff'

/**
 * DetectResultView 是「智能解析结果」的唯一渲染器（工具箱内与划选面板共用），
 * 它决定了：类型标签、Tab 切换、字段/长文本块、复制、下载，以及「在 XX 工具中打开」的手递手。
 *
 * 这里刻意 mock 掉两个外部协作者，把断言聚焦在「视图到底渲染了什么、回调收到什么」：
 * - `@/utils/clipboard`：真实复制会碰系统剪贴板，且结果不可观察；
 * - `./handoff`：真实实现会读写 chrome.storage（另见 handoff.test.ts 的契约用例）。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }))
vi.mock('./handoff', () => ({ toolForDetectKind: vi.fn(() => null) }))

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  // 每个用例都从中文开始（英文用例内部自行切换并切回），避免依赖执行顺序
  await i18n.changeLanguage('zh')
  vi.mocked(toolForDetectKind).mockReturnValue(null)
  vi.mocked(copyText).mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

// ---------------------------------------------------------------------------
// 夹具与查询工具
// ---------------------------------------------------------------------------

function field(key: string, value: string, mono = false): DetectField {
  return mono ? { key, value, mono: true } : { key, value }
}

function block(key: string, value: string, extra: Partial<DetectBlock> = {}): DetectBlock {
  return { key, value, ...extra }
}

function result(over: Partial<DetectResult> = {}): DetectResult {
  return { kind: 'json', fields: [], blocks: [], copy: '{"a":1}', ...over }
}

function render(props: DetectResultViewProps) {
  act(() => {
    root.render(<DetectResultView {...props} />)
  })
}

// .tsx 里泛型箭头函数会被解析成 JSX，查询工具统一写成函数声明
function q<T extends Element = Element>(sel: string): T | null {
  return container.querySelector<T>(sel)
}
function qa<T extends Element = Element>(sel: string): T[] {
  return [...container.querySelectorAll<T>(sel)]
}
const text = () => container.textContent ?? ''
const textsOf = (sel: string) => qa(sel).map((el) => el.textContent ?? '')

/** 人造 DOMRect：happy-dom 无排版，真实 rect 全为 0，无法验证横向居中计算 */
function rect(top: number, height: number, width = 40, left = 0): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    width,
    left,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as unknown as DOMRect
}

function makeItem(kind: DetectItem['kind'], copy: string): DetectItem {
  const m = { text: copy, startIndex: 0, endIndex: copy.length, active: true }
  return { kind, fields: [], blocks: [], copy, sourceMatches: [m], sourceMatch: m }
}

/** 断言界面上没有把 i18n key 原样漏出来（漏 key 时页面会出现 "tool.detect.row.xxx"） */
function expectNoBareI18nKey() {
  expect(text()).not.toMatch(/\b(?:tool|common|settings)\.[A-Za-z]/)
}

describe('DetectResultView 的类型标签与整体骨架', () => {
  it('头部展示「解析为：<类型>」，8 种解析类型各有固定标签', () => {
    const cases: Array<[DetectResult['kind'], string]> = [
      ['json', 'JSON'],
      ['jwt', 'JWT'],
      ['url', 'URL'],
      ['timestamp', 'Timestamp'],
      ['uuid', 'UUID'],
      ['base64', 'Base64'],
      ['hex', 'Hex'],
      ['dataurl', 'Data URL'],
    ]
    for (const [kind, label] of cases) {
      render({ result: result({ kind }) })
      expect(q('.tw-status--ok')?.textContent).toBe(i18n.t('tool.detect.detected', { kind: label }))
    }
  })

  it('解析解释提示（hint）渲染为一行说明：按行解析 / 折行各一条', () => {
    render({ result: result({ kind: 'base64', hint: 'base64-lines' }) })
    expect(container.textContent).toContain(i18n.t('tool.detect.hintBase64Lines'))
    expectNoBareI18nKey()

    render({ result: result({ kind: 'base64', hint: 'base64-wrapped' }) })
    expect(container.textContent).toContain(i18n.t('tool.detect.hintBase64Wrapped'))
    expectNoBareI18nKey()
  })

  it('没有 hint 时不渲染任何解释说明（不留空占位）', () => {
    render({ result: result({ kind: 'base64' }) })
    expect(container.textContent).not.toContain(i18n.t('tool.detect.hintBase64Lines'))
    expect(container.textContent).not.toContain(i18n.t('tool.detect.hintBase64Wrapped'))
  })

  it('未知类型（运行时脏数据）不崩溃，类型名处显示兜底文案', () => {
    const dirty = result({ kind: 'nope' as DetectResult['kind'] })
    expect(() => render({ result: dirty })).not.toThrow()

    // KIND_LABEL 取不到脏 kind 时回退到 tool.detect.unknown，而不是渲染成空白
    expect(q('.tw-status--ok')?.textContent).toBe(
      i18n.t('tool.detect.detected', { kind: i18n.t('tool.detect.unknown') }),
    )
    expect(text()).not.toContain('undefined')
    expectNoBareI18nKey()
  })

  it('空结果（无 field / 无 block）只渲染头部，不出现空的字段区与内容块', () => {
    render({ result: result({ kind: 'uuid' }) })
    expect(q('.tw-detect__head')).not.toBeNull()
    expect(q('.tw-detect__fields')).toBeNull()
    expect(q('.tw-detect__block')).toBeNull()
    expect(q('.tw-detect__tabs')).toBeNull()
    expect(q('.tw-actions')).toBeNull()
  })
})

describe('DetectResultView 的字段行', () => {
  it('字段标签走 i18n，值原样展示，mono 字段带等宽修饰类', () => {
    render({
      result: result({
        kind: 'base64',
        fields: [field('bytes', '4 B', true), field('valid', '✓')],
      }),
    })

    expect(textsOf('.tw-detect__field-label')).toEqual([
      i18n.t('tool.detect.row.bytes'),
      i18n.t('tool.detect.row.valid'),
    ])
    expect(textsOf('.tw-detect__field-value')).toEqual(['4 B', '✓'])
    // 只有 mono 字段加等宽类
    expect(qa('.tw-detect__field-value--mono')).toHaveLength(1)
    expect(q('.tw-detect__field-value--mono')?.textContent).toBe('4 B')
    expectNoBareI18nKey()
  })

  it('url.N 键生成带序号的网址标签', () => {
    render({
      result: result({
        kind: 'url',
        fields: [field('url.1', 'https://a.example'), field('url.2', 'https://b.example')],
      }),
    })
    expect(textsOf('.tw-detect__field-label')).toEqual([
      `${i18n.t('tool.detect.row.url')} 1`,
      `${i18n.t('tool.detect.row.url')} 2`,
    ])
  })

  it('claim.* 与 url 组件键分别走 JWT / URL 的专属标签', () => {
    render({
      result: result({
        kind: 'jwt',
        fields: [field('algorithm', 'HS256', true), field('claim.exp', '2025-01-01')],
      }),
    })
    expect(textsOf('.tw-detect__field-label')).toEqual([
      i18n.t('tool.detect.row.algorithm'),
      i18n.t('tool.jwt.claim.exp'),
    ])

    render({ result: result({ kind: 'url', fields: [field('protocol', 'https:')] }) })
    expect(q('.tw-detect__field-label')?.textContent).toBe(i18n.t('tool.url.component.protocol'))
  })
})

describe('DetectResultView 的内容块分支', () => {
  const formatted = '{\n  "a": 1\n}'
  const minified = '{"a":1}'

  it('json 多行块用语法高亮渲染并带行号', () => {
    render({
      result: result({
        blocks: [
          block('parsed', formatted, {
            json: true,
            formattedValue: formatted,
            minifiedValue: minified,
          }),
        ],
      }),
    })

    expect(q('pre.tw-json-hl')).not.toBeNull()
    expect(qa('.tw-json-hl__line')).toHaveLength(3)
    expect(textsOf('.tw-json-hl__content').join('\n')).toBe(formatted)
    // json 块不应落到普通只读 textarea 分支
    expect(q('textarea.tw-area--result')).toBeNull()
  })

  it('单行纯文本块用只读 AutoArea 渲染，带结果占位符', () => {
    render({ result: result({ kind: 'hex', blocks: [block('decoded', 'hello ·')] }) })

    const ta = q<HTMLTextAreaElement>('textarea.tw-area--result')
    expect(ta).not.toBeNull()
    expect(ta?.value).toBe('hello ·')
    expect(ta?.readOnly).toBe(true)
    expect(ta?.getAttribute('placeholder')).toBe(i18n.t('tool.detect.resultPlaceholder'))
    expect(q('pre.tw-json-hl')).toBeNull()
  })

  it('非 json 但多行的块同样走语法高亮（多行即可读性优先）', () => {
    render({ result: result({ kind: 'base64', blocks: [block('decoded', 'l1\nl2')] }) })
    expect(q('pre.tw-json-hl')).not.toBeNull()
    expect(qa('.tw-json-hl__line')).toHaveLength(2)
    expect(q('textarea.tw-area--result')).toBeNull()
  })

  it('image 块渲染图片预览，alt 走 i18n 文案', () => {
    const dataUrl = 'data:image/png;base64,iVBORw=='
    render({
      result: result({
        kind: 'dataurl',
        blocks: [block('image', dataUrl, { image: true })],
      }),
    })

    const img = q<HTMLImageElement>('img.tw-detect__image')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe(dataUrl)
    expect(img?.getAttribute('alt')).toBe(i18n.t('tool.detect.previewAlt'))
  })

  it('有 minifiedValue 时出现「单行压缩」开关，勾选后在格式化/压缩内容间切换', () => {
    render({
      result: result({
        blocks: [
          block('parsed', formatted, {
            json: true,
            formattedValue: formatted,
            minifiedValue: minified,
          }),
        ],
      }),
    })

    const cb = q<HTMLInputElement>('.tk-checkbox input')
    expect(cb).not.toBeNull()
    expect(cb?.checked).toBe(false)
    expect(q('.tk-checkbox span')?.textContent).toBe(i18n.t('tool.detect.minifyOption'))
    expect(qa('.tw-json-hl__line')).toHaveLength(3)

    act(() => cb?.click())
    expect(q<HTMLInputElement>('.tk-checkbox input')?.checked).toBe(true)
    expect(q('pre.tw-json-hl')?.textContent).toBe(minified)
    // 压缩成单行后不再需要行号栏
    expect(qa('.tw-json-hl__line')).toHaveLength(0)

    act(() => q<HTMLInputElement>('.tk-checkbox input')?.click())
    expect(q<HTMLInputElement>('.tk-checkbox input')?.checked).toBe(false)
    expect(textsOf('.tw-json-hl__content').join('\n')).toBe(formatted)
  })

  it('没有 minifiedValue 的块不渲染压缩开关', () => {
    render({ result: result({ kind: 'hex', blocks: [block('decoded', 'abc')] }) })
    expect(q('.tw-detect__block-options')).toBeNull()
    expect(q('.tk-checkbox')).toBeNull()
  })

  it('JWT 解码块不显示行号（避免行号栏挤占本就很窄的面板）', () => {
    const jwtHeader = '{\n  "alg": "HS256"\n}'
    render({
      result: result({ kind: 'jwt', blocks: [block('header', jwtHeader, { json: true })] }),
    })
    expect(q('pre.tw-json-hl')).not.toBeNull()
    expect(q('.tw-json-hl__line')).toBeNull()
    expect(q('pre.tw-json-hl')?.textContent).toBe(jwtHeader)
  })

  it('block.value 变化时压缩开关被重置回格式化视图', () => {
    const props = (value: string, mini: string): DetectResultViewProps => ({
      result: result({
        blocks: [
          block('parsed', value, { json: true, formattedValue: value, minifiedValue: mini }),
        ],
      }),
    })

    render(props(formatted, minified))
    act(() => q<HTMLInputElement>('.tk-checkbox input')?.click())
    expect(q<HTMLInputElement>('.tk-checkbox input')?.checked).toBe(true)

    // 换成另一份解析结果（block.key 不变，state 会被保留）→ 必须复位，否则会继续显示上一份的压缩态
    const next = '{\n  "b": 2\n}'
    render(props(next, '{"b":2}'))
    expect(q<HTMLInputElement>('.tk-checkbox input')?.checked).toBe(false)
    expect(textsOf('.tw-json-hl__content').join('\n')).toBe(next)
  })
})

describe('DetectResultView 的复制与下载', () => {
  it('字段复制按钮把该字段的值交给剪贴板', async () => {
    render({ result: result({ kind: 'hex', fields: [field('bytes', '4 B', true)] }) })

    const btn = q<HTMLButtonElement>('.tw-detect__copy')
    expect(btn?.getAttribute('aria-label')).toBe(i18n.t('common.copy'))
    await act(async () => btn?.click())

    expect(copyText).toHaveBeenCalledWith('4 B')
  })

  it('内容块复制按钮复制的是当前展示值（压缩后即为压缩文本）', async () => {
    const formatted = '{\n  "a": 1\n}'
    const minified = '{"a":1}'
    render({
      result: result({
        blocks: [
          block('parsed', formatted, {
            json: true,
            formattedValue: formatted,
            minifiedValue: minified,
          }),
        ],
      }),
    })

    const btn = q<HTMLButtonElement>('.tw-detect__block .tw-link')
    await act(async () => btn?.click())
    expect(copyText).toHaveBeenCalledWith(formatted)
    // 非图标模式复制成功后文案变为「已复制」
    expect(q('.tw-detect__block .tw-link')?.textContent).toBe(i18n.t('common.copied'))

    act(() => q<HTMLInputElement>('.tk-checkbox input')?.click())
    await act(async () => q<HTMLButtonElement>('.tw-detect__block .tw-link')?.click())
    expect(copyText).toHaveBeenLastCalledWith(minified)
  })

  it('复制失败时不显示「已复制」', async () => {
    vi.mocked(copyText).mockResolvedValue(false)
    render({ result: result({ kind: 'hex', blocks: [block('decoded', 'abc')] }) })

    const btn = q<HTMLButtonElement>('.tw-detect__block .tw-link')
    await act(async () => btn?.click())

    expect(q('.tw-detect__block .tw-link')?.textContent).toBe(i18n.t('common.copy'))
  })

  it('有 download 时渲染下载按钮，按钮可访问名是默认文件名', () => {
    const download = { mime: 'image/png', dataUrl: 'data:image/png;base64,iVBORw==', sizeBytes: 4 }
    render({ result: result({ kind: 'base64', download }) })

    const btn = q<HTMLButtonElement>('.tw-actions button')
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toContain(i18n.t('tool.detect.download'))
    expect(btn?.getAttribute('aria-label')).toBe('image.png')
  })
})

describe('DetectResultView 的多结果 Tab', () => {
  const items = [makeItem('base64', 'a'), makeItem('url', 'https://b.example')]

  it('多项结果时渲染 Tab 与总数徽标，aria-selected 反映激活项', () => {
    render({
      result: result({ kind: 'base64' }),
      items,
      activeMatchIndex: 1,
      onSelectMatch: () => {},
    })

    expect(qa('.tw-detect__tab')).toHaveLength(2)
    expect(q('.tw-detect__total-badge')?.textContent).toBe(
      i18n.t('tool.detect.totalMatches', { count: 2 }),
    )
    expect(textsOf('.tw-detect__tab-kind')).toEqual(['Base64', 'URL'])
    expect(qa('.tw-detect__tab')[1].getAttribute('aria-selected')).toBe('true')
    expect(qa('.tw-detect__tab')[0].getAttribute('aria-selected')).toBe('false')
    expect(qa('.tw-detect__tab--active')).toHaveLength(1)
    expect(q('.tw-detect__tab--active')?.getAttribute('aria-label')).toBe('2 · URL')
  })

  it('脏 kind 的 Tab 标签同样回退到兜底文案（tab-kind 与 aria-label）', () => {
    render({
      result: result({ kind: 'base64' }),
      items: [items[0], makeItem('nope' as DetectItem['kind'], 'x')],
      activeMatchIndex: 1,
      onSelectMatch: () => {},
    })

    expect(textsOf('.tw-detect__tab-kind')).toEqual(['Base64', i18n.t('tool.detect.unknown')])
    expect(q('.tw-detect__tab--active')?.getAttribute('aria-label')).toBe(
      `2 · ${i18n.t('tool.detect.unknown')}`,
    )
  })

  it('点击 Tab 回调索引；只有单项或没有回调时不渲染 Tab', () => {
    const onSelectMatch = vi.fn()
    render({ result: result({ kind: 'base64' }), items, activeMatchIndex: 0, onSelectMatch })

    act(() => qa<HTMLButtonElement>('.tw-detect__tab')[1].click())
    expect(onSelectMatch).toHaveBeenCalledWith(1)

    // 单项：没有切换的意义
    render({
      result: result({ kind: 'base64' }),
      items: [items[0]],
      activeMatchIndex: 0,
      onSelectMatch,
    })
    expect(q('.tw-detect__tabs')).toBeNull()
    expect(q('.tw-detect__total-badge')).toBeNull()

    // 多项但宿主没给切换回调：同样不渲染，否则 Tab 点了没反应
    render({ result: result({ kind: 'base64' }), items, activeMatchIndex: 0 })
    expect(q('.tw-detect__tabs')).toBeNull()
  })

  it('点击 Tab 时把激活项横向滚动到容器中心（smooth）', () => {
    render({
      result: result({ kind: 'base64' }),
      items,
      activeMatchIndex: 0,
      onSelectMatch: () => {},
    })

    const tabsEl = q<HTMLDivElement>('.tw-detect__tabs')
    const btns = qa<HTMLButtonElement>('.tw-detect__tab')
    if (!tabsEl) throw new Error('未渲染出 Tab 容器')
    tabsEl.getBoundingClientRect = () => rect(0, 20, 300, 0)
    // 第二个 Tab 位于 x=250..300，中心 275；容器中心 150 → 应右移 125
    btns[1].getBoundingClientRect = () => rect(0, 20, 50, 250)
    const scrollBy = vi.fn()
    tabsEl.scrollBy = scrollBy as unknown as HTMLElement['scrollBy']

    act(() => btns[1].click())
    expect(scrollBy).toHaveBeenCalledWith({ left: 125, behavior: 'smooth' })
  })

  it('窗口 resize 时用 auto 行为重新居中（不做平滑动画）', () => {
    render({
      result: result({ kind: 'base64' }),
      items,
      activeMatchIndex: 1,
      onSelectMatch: () => {},
    })

    const tabsEl = q<HTMLDivElement>('.tw-detect__tabs')
    const btns = qa<HTMLButtonElement>('.tw-detect__tab')
    if (!tabsEl) throw new Error('未渲染出 Tab 容器')
    tabsEl.getBoundingClientRect = () => rect(0, 20, 300, 0)
    btns[1].getBoundingClientRect = () => rect(0, 20, 50, 250)
    const scrollBy = vi.fn()
    tabsEl.scrollBy = scrollBy as unknown as HTMLElement['scrollBy']

    act(() => {
      window.dispatchEvent(new window.Event('resize'))
    })
    expect(scrollBy).toHaveBeenCalledWith({ left: 125, behavior: 'auto' })
  })

  it('纵向滚轮在 Tab 栏上转为横向滚动，纯横向滚轮不拦截', () => {
    render({
      result: result({ kind: 'base64' }),
      items,
      activeMatchIndex: 0,
      onSelectMatch: () => {},
    })

    const tabsEl = q<HTMLDivElement>('.tw-detect__tabs')
    if (!tabsEl) throw new Error('未渲染出 Tab 容器')

    const vertical = new window.WheelEvent('wheel', {
      deltaY: 40,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      tabsEl.dispatchEvent(vertical)
    })
    expect(vertical.defaultPrevented).toBe(true)
    expect(tabsEl.scrollLeft).toBe(40)

    const horizontal = new window.WheelEvent('wheel', {
      deltaX: 50,
      deltaY: 0,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      tabsEl.dispatchEvent(horizontal)
    })
    expect(horizontal.defaultPrevented).toBe(false)
    expect(tabsEl.scrollLeft).toBe(40)
  })
})

describe('DetectResultView 的「在 XX 工具中打开」手递手', () => {
  it('json 命中时渲染入口，点击回调把激活匹配的原文交给目标工具', () => {
    vi.mocked(toolForDetectKind).mockReturnValue('json')
    const onOpenInTool = vi.fn()
    render({
      result: result({
        kind: 'json',
        copy: '{"a":1}',
        sourceMatches: [{ text: '原文片段', startIndex: 3, endIndex: 7, active: true }],
      }),
      onOpenInTool,
    })

    const btn = q<HTMLButtonElement>('.tw-detect__head-action')
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toContain(
      i18n.t('tool.detect.openInTool', { tool: i18n.t('tool.registry.json') }),
    )

    act(() => btn?.click())
    expect(onOpenInTool).toHaveBeenCalledWith('json', '原文片段')
  })

  it('没有激活匹配时退回 result.copy（纯净输入没有可高亮的区间）', () => {
    vi.mocked(toolForDetectKind).mockReturnValue('url')
    const onOpenInTool = vi.fn()
    render({
      result: result({
        kind: 'url',
        copy: 'https://example.com/',
        sourceMatches: [{ text: 'example.com', startIndex: 8, endIndex: 19, active: false }],
      }),
      onOpenInTool,
    })

    act(() => q<HTMLButtonElement>('.tw-detect__head-action')?.click())
    expect(onOpenInTool).toHaveBeenCalledWith('url', 'https://example.com/')
  })

  it('类型没有目标工具、或宿主未提供回调时不渲染入口', () => {
    const onOpenInTool = vi.fn()
    // 默认 mock 返回 null：base64 这类展示已对齐的类型不给入口
    render({ result: result({ kind: 'base64', copy: 'x' }), onOpenInTool })
    expect(q('.tw-detect__head-action')).toBeNull()

    // 有目标工具但宿主没接回调：入口点了无从落地，同样不渲染
    vi.mocked(toolForDetectKind).mockReturnValue('json')
    render({ result: result({ kind: 'json', copy: '{"a":1}' }) })
    expect(q('.tw-detect__head-action')).toBeNull()
  })
})

describe('DetectResultView 的双语文案与 key 完整性', () => {
  const rich = () =>
    result({
      kind: 'json',
      fields: [field('url.1', 'https://example.com/a'), field('bytes', '12 B', true)],
      blocks: [
        block('parsed', '{\n  "a": 1\n}', {
          json: true,
          formattedValue: '{\n  "a": 1\n}',
          minifiedValue: '{"a":1}',
        }),
      ],
    })

  it('中文：界面文案来自 zh 语言包，且不出现裸 i18n key', () => {
    render({ result: rich() })

    expect(text()).toContain(i18n.t('tool.detect.detected', { kind: 'JSON' }))
    expect(text()).toContain(i18n.t('tool.detect.row.parsed'))
    expect(text()).toContain(`${i18n.t('tool.detect.row.url')} 1`)
    expect(text()).toContain(i18n.t('tool.detect.minifyOption'))
    expect(text()).toMatch(/[\u4e00-\u9fff]/)
    expectNoBareI18nKey()
  })

  it('英文：切到 en 后全部文案不含中文，且同样不漏 key', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    render({ result: rich() })

    expect(text()).toContain('Parsed as: JSON')
    expect(text()).toContain('Parsed Result')
    expect(text()).toContain('URL 1')
    expect(text()).toContain('Minify (single-line)')
    // 回归：分隔符已并入文案，英文界面不能再出现全角「：」
    expect(text()).not.toContain('：')
    // 英文界面不能残留任何中文字符
    expect(text()).not.toMatch(/[\u4e00-\u9fff]/)
    expectNoBareI18nKey()

    await act(async () => {
      await i18n.changeLanguage('zh')
    })
  })
})
