// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDraftValue, setDraftValue } from '@/utils/draft'

// 副作用导入：初始化 i18next 实例，否则 useTranslation 拿不到实例
import '@/i18n'

import { copyText } from '@/utils/clipboard'

import UrlTool from './UrlTool'

/**
 * 网址工具是「两个 tab + 两个常驻面板」的结构：解析面板与编解码面板都挂载，仅按 tab 显隐。
 * 因此这里重点验证：tab 显隐与各自的草稿独立、解析/编解码两条结果路径、空输入红框与错误位置。
 * 纯逻辑（parseUrl / encodeUrl / decodeUrl / flattenParams）已有 url.test.ts，不重复。
 */

vi.mock('@/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }))

// React 19 的 act 需要该标记
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let store: Record<string, unknown>
let listeners: ChangeListener[]

function stubChrome() {
  store = {}
  listeners = []
  const area = {
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj: Record<string, unknown>) => {
      Object.assign(store, obj)
    },
    remove: async (key: string) => {
      delete store[key]
    },
  }
  globalWithChrome.chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      session: area,
      sync: area,
      local: area,
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          listeners = listeners.filter((item) => item !== listener)
        },
      },
    },
  }
}

let container: HTMLDivElement
let root: Root

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set
  nativeSetter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 解析面板 / 编解码面板（按 DOM 顺序，二者始终都在） */
function panels(): HTMLDivElement[] {
  return [...container.querySelectorAll<HTMLDivElement>('.tw-sec')]
}

function parsePanel(): HTMLDivElement {
  return panels()[0]
}

function codecPanel(): HTMLDivElement {
  return panels()[1]
}

function parseInput(): HTMLTextAreaElement {
  const el = parsePanel().querySelector<HTMLTextAreaElement>('textarea')
  if (!el) throw new Error('未找到解析输入框')
  return el
}

function codecInput(): HTMLTextAreaElement {
  const el = codecPanel().querySelector<HTMLTextAreaElement>('textarea')
  if (!el) throw new Error('未找到编解码输入框')
  return el
}

/** 编解码面板里除输入框外的第二个 textarea 即只读结果区 */
function codecOutput(): HTMLTextAreaElement {
  const all = codecPanel().querySelectorAll<HTMLTextAreaElement>('textarea')
  if (all.length < 2) throw new Error('未找到编解码结果区')
  return all[1]
}

function buttonByText(text: string, scope: ParentNode = container): HTMLButtonElement {
  const btn = [...scope.querySelectorAll('button')].find((el) => el.textContent?.trim() === text)
  if (!btn) throw new Error(`未找到按钮：${text}`)
  return btn
}

function tab(name: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (el) => el.textContent?.trim() === name,
  )
  if (!btn) throw new Error(`未找到 tab：${name}`)
  return btn
}

async function renderTool() {
  await act(async () => {
    root.render(<UrlTool />)
  })
}

/** 解析面板是 80ms 防抖实时解析，放行超过防抖窗口后再断言 */
async function flushDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120))
  })
}

async function switchToCodec() {
  await act(async () => tab('网址编解码').click())
}

/** 草稿写入是 200ms 防抖：要验证「重挂载恢复」，必须等它真正落进会话存储 */
async function flushDraft() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 240))
  })
}

beforeEach(async () => {
  stubChrome()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // 草稿的模块级 memoryCache 常驻：三个 key 全部归零，用例之间互不影响
  await setDraftValue('url.tab', 'parse')
  await setDraftValue('url.parse.input', '')
  // 编解码草稿：默认值已提为模块常量（见 UrlTool.tsx 的 DEFAULT_CODEC_DRAFT），
  // 因此这里用 setDraftValue 把内存缓存与会话存储一起归零即可，不存在「缓存/存储不一致」的特殊状态
  await setDraftValue('url.codec', { scope: 'component', input: '', output: '' })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
  vi.clearAllMocks()
})

describe('UrlTool tab 切换', () => {
  it('两个 tab 可切换：aria-selected 与面板显隐同步，另一面板仍在 DOM 中', async () => {
    await renderTool()

    const parseWrap = parsePanel().parentElement as HTMLDivElement
    const codecWrap = codecPanel().parentElement as HTMLDivElement
    expect(tab('网址解析').getAttribute('aria-selected')).toBe('true')
    expect(parseWrap.hidden).toBe(false)
    expect(codecWrap.hidden).toBe(true)

    await switchToCodec()

    expect(tab('网址编解码').getAttribute('aria-selected')).toBe('true')
    expect(tab('网址解析').getAttribute('aria-selected')).toBe('false')
    expect(parseWrap.hidden).toBe(true)
    expect(codecWrap.hidden).toBe(false)
    // 两个面板都常驻，以保证各自草稿/状态不丢
    expect(panels()).toHaveLength(2)
  })

  it('切到编解码页后 url.tab 草稿记为 codec，重挂载仍停在该页', async () => {
    await renderTool()
    await switchToCodec()

    expect(await getDraftValue('url.tab')).toBe('codec')
    await flushDraft()

    act(() => root.unmount())
    root = createRoot(container)
    await renderTool()

    expect(tab('网址编解码').getAttribute('aria-selected')).toBe('true')
    expect((codecPanel().parentElement as HTMLDivElement).hidden).toBe(false)
  })
})

describe('UrlTool 网址解析', () => {
  it('解析输入以字符串草稿 url.parse.input 保存，重挂载可恢复', async () => {
    await renderTool()
    await act(async () => setTextareaValue(parseInput(), 'https://example.com/path'))

    expect(await getDraftValue('url.parse.input')).toBe('https://example.com/path')
    await flushDraft()

    act(() => root.unmount())
    root = createRoot(container)
    await renderTool()

    expect(parseInput().value).toBe('https://example.com/path')
  })

  it('输入非法网址时，错误提示紧贴操作栏下方，且不渲染结果区', async () => {
    await renderTool()
    await act(async () => setTextareaValue(parseInput(), 'not a url'))
    await flushDebounce()

    const actions = parsePanel().querySelector('.tw-actions')
    expect(actions?.nextElementSibling?.className).toContain('tw-status--err')
    expect(actions?.nextElementSibling?.textContent).toBe('无效的 URL')
    expect(parsePanel().querySelector('.tw-detect')).toBeNull()
  })

  it('合法网址渲染协议/主机/端口/路径各部分与 Query 参数，并为整串参数提供复制', async () => {
    await renderTool()
    await act(async () =>
      setTextareaValue(parseInput(), 'https://user:pw@example.com:8443/path/to?x=1&y=2#frag'),
    )
    await flushDebounce()

    const text = parsePanel().textContent ?? ''
    expect(text).toContain('协议')
    expect(text).toContain('https:')
    expect(text).toContain('主机')
    expect(text).toContain('example.com:8443')
    expect(text).toContain('端口')
    expect(text).toContain('8443')
    expect(text).toContain('路径')
    expect(text).toContain('/path/to')
    expect(text).toContain('用户名')
    expect(text).toContain('片段 (Fragment)')
    expect(text).toContain('#frag')
    // Query 参数区：标题 + 每个参数一行
    expect(text).toContain('查询参数')
    const labels = [...parsePanel().querySelectorAll('.tw-detect__field-label')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(expect.arrayContaining(['x', 'y']))
  })

  it('解析为空时不渲染任何结果或错误（清空后回到初始态）', async () => {
    await renderTool()
    expect(parsePanel().querySelector('.tw-detect')).toBeNull()
    expect(parsePanel().querySelector('.tw-status')).toBeNull()

    await act(async () => setTextareaValue(parseInput(), 'https://example.com'))
    await flushDebounce()
    expect(parsePanel().querySelector('.tw-detect')).not.toBeNull()

    await act(async () => buttonByText('清空', parsePanel()).click())
    expect(parseInput().value).toBe('')
    expect(parsePanel().querySelector('.tw-detect')).toBeNull()
    // clearDraft 会删缓存并异步 remove 存储：读回 null 或空串都算已清空
    const cleared = await getDraftValue<string>('url.parse.input')
    expect(cleared === null || cleared === '').toBe(true)
  })
})

describe('UrlTool 网址编解码', () => {
  it('空输入点「编码网址」：输入框加 empty-err 红框并聚焦，不弹文字横幅', async () => {
    await renderTool()
    await switchToCodec()

    await act(async () => buttonByText('编码网址', codecPanel()).click())

    expect(codecInput().className).toContain('tw-area--empty-err')
    expect(document.activeElement).toBe(codecInput())
    expect(codecPanel().querySelector('.tw-status')).toBeNull()
    expect(codecPanel().querySelectorAll('textarea')).toHaveLength(1)
  })

  it('组件模式编码得到结果，结果区只读且可复制', async () => {
    await renderTool()
    await switchToCodec()
    await act(async () => setTextareaValue(codecInput(), 'a b&c=d'))

    await act(async () => buttonByText('编码网址', codecPanel()).click())
    expect(codecOutput().value).toBe('a%20b%26c%3Dd')
    expect(codecOutput().readOnly).toBe(true)

    const copyButton = codecPanel().querySelector<HTMLButtonElement>('button[aria-label="复制"]')
    expect(copyButton).not.toBeNull()
    await act(async () => {
      copyButton?.click()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(vi.mocked(copyText)).toHaveBeenCalledWith('a%20b%26c%3Dd')
    // 复制成功后按钮节点会被 Tooltip 包裹替换，必须重新查询
    expect(codecPanel().querySelector('button[aria-label="复制"]')?.textContent).toBe('已复制')
  })

  it('切换编码范围后，按新范围重跑上一次的编码操作', async () => {
    await renderTool()
    await switchToCodec()
    await act(async () => setTextareaValue(codecInput(), 'a b&c=d'))
    await act(async () => buttonByText('编码网址', codecPanel()).click())
    expect(codecOutput().value).toBe('a%20b%26c%3Dd')

    // 打开范围下拉（TkSelect 是自定义 combobox，选项 portal 到 body），选「完整网址 (encodeURI)」
    const trigger = codecPanel().querySelector<HTMLButtonElement>('[role="combobox"]')
    expect(trigger).not.toBeNull()
    await act(async () => trigger?.click())
    const option = [...document.querySelectorAll<HTMLElement>('.tk-select-item')].find((el) =>
      el.textContent?.includes('完整网址 (encodeURI)'),
    )
    expect(option).not.toBeUndefined()
    await act(async () => {
      option?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    // full 范围用 encodeURI：保留 & 与 =，只编码空格
    expect(codecOutput().value).toBe('a%20b&c=d')
  })

  it('解码到非法 % 序列时报「URI malformed」，不产出结果', async () => {
    await renderTool()
    await switchToCodec()
    await act(async () => setTextareaValue(codecInput(), '%E0%A4%A'))

    await act(async () => buttonByText('解码网址', codecPanel()).click())

    const status = codecPanel().querySelector('.tw-status--err')
    expect(status?.textContent).toContain('URI malformed')
    expect(codecPanel().querySelectorAll('textarea')).toHaveLength(1)
  })

  it('两个面板的输入与结果互不影响（tab 切换不丢状态）', async () => {
    await renderTool()
    await act(async () => setTextareaValue(parseInput(), 'https://example.com/keep'))
    await flushDebounce()

    await switchToCodec()
    await act(async () => setTextareaValue(codecInput(), 'hello world'))
    await act(async () => buttonByText('编码网址', codecPanel()).click())
    expect(codecOutput().value).toBe('hello%20world')

    // 切回解析页：解析输入与结果原样保留
    await act(async () => tab('网址解析').click())
    expect(parseInput().value).toBe('https://example.com/keep')
    expect(parsePanel().textContent).toContain('example.com')

    // 再切回编解码页：输入与输出同样原样保留
    await switchToCodec()
    expect(codecInput().value).toBe('hello world')
    expect(codecOutput().value).toBe('hello%20world')
  })

  it('编解码草稿是 {scope,input,output} 对象，重挂载恢复输入与结果', async () => {
    await renderTool()
    await switchToCodec()
    await act(async () => setTextareaValue(codecInput(), 'hello world'))
    await act(async () => buttonByText('编码网址', codecPanel()).click())

    const draft = await getDraftValue<{ scope: string; input: string; output: string }>('url.codec')
    expect(draft).toEqual({ scope: 'component', input: 'hello world', output: 'hello%20world' })

    await flushDraft()
    // 回归：默认值提为模块常量后，useToolDraft 的挂载 effect 不再每帧重跑，
    // 200ms 防抖写入能真正落到 chrome.storage.session（此前会被每帧 cleanup 取消，永不落盘）
    expect(store['panda.draft.url.codec']).toEqual({
      scope: 'component',
      input: 'hello world',
      output: 'hello%20world',
    })

    act(() => root.unmount())
    root = createRoot(container)
    await renderTool()
    await switchToCodec()

    expect(codecInput().value).toBe('hello world')
    expect(codecOutput().value).toBe('hello%20world')
  })

  it('存储里的旧 url.codec 不会在用户输入后把内容回滚（回归）', async () => {
    // 只改存储、不动内存缓存，模拟「上一会话留下的旧草稿」在新会话被挂载读取
    store['panda.draft.url.codec'] = {
      scope: 'component',
      input: 'OLD',
      output: 'OLD-OUT',
    }
    await renderTool()
    await switchToCodec()
    expect(codecInput().value).toBe('OLD')

    await act(async () => setTextareaValue(codecInput(), 'NEW'))
    await flushDraft()

    // 旧实现里每次渲染都会重跑挂载 effect，把 OLD 重新读回来覆盖 NEW；现在必须保持 NEW
    expect(codecInput().value).toBe('NEW')
    expect(store['panda.draft.url.codec']).toMatchObject({ input: 'NEW' })
  })
})
