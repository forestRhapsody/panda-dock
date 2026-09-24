// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { copyText } from '@/utils/clipboard'
import { getDraftValue, setDraftValue } from '@/utils/draft'

import { downloadText } from './file'
import JsonTool, { DEFAULT_JSON_DRAFT, JSON_DRAFT_KEY } from './JsonTool'

/**
 * JSON 工作台的组件层行为：输入 → 操作栏 → 状态/错误 → 结果区只读展示。
 * 纯逻辑（formatJson / minifyJson / escapeJson…）已有 json.test.ts，这里只断言「点下去之后 DOM 里真实发生了什么」。
 */

// 复制与下载都接了外部副作用，必须 mock 掉：真剪贴板在 happy-dom 下不可用，下载会创建 <a> 触发跳转
vi.mock('@/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }))
// 只替换 downloadText，保留 fmtSize：结果区的「大小 · 行数」统计依赖它
vi.mock('@/tools/file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/file')>()
  return { ...actual, downloadText: vi.fn() }
})

// React 19 的 act 需要该标记，否则事件派发会打印 "not wrapped in act" 告警
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let store: Record<string, unknown>
let listeners: ChangeListener[]

/** 内存版 chrome.storage 桩：session/sync/local 同源，并带 runtime.id 让 isExtension() 为真 */
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

function textarea(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('.tw-json-editor__input')
  if (!el) throw new Error('未找到 JSON 输入框')
  return el
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === text,
  )
  if (!btn) throw new Error(`未找到按钮：${text}`)
  return btn
}

function checkboxByLabel(label: string): HTMLInputElement {
  const wrap = [...container.querySelectorAll('label.pd-checkbox')].find((el) =>
    el.textContent?.includes(label),
  )
  const input = wrap?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error(`未找到复选框：${label}`)
  return input
}

/**
 * 结果区的真实文本：多行结果会带上等宽行号栏（每行一个 .tw-json-hl__content），
 * 直接读 container.textContent 会把行号混进来，所以按行拼接内容节点。
 */
function viewerText(): string {
  // 无结果时高亮层渲染占位文案（.tw-json-hl__empty），不算结果内容
  if (container.querySelector('.tw-json-hl__empty')) return ''
  const lines = container.querySelectorAll('.tw-json-hl__content')
  if (lines.length > 0) {
    return [...lines].map((el) => el.textContent ?? '').join('\n')
  }
  return container.querySelector('.tw-json__viewer code')?.textContent ?? ''
}

async function renderTool() {
  await act(async () => {
    root.render(<JsonTool />)
  })
}

/** 输入文本 + 点一次「格式化」，返回渲染后的结果文本 */
async function formatInput(input: string) {
  await renderTool()
  await act(async () => setTextareaValue(textarea(), input))
  await act(async () => buttonByText('格式化').click())
}

beforeEach(async () => {
  stubChrome()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // 草稿的模块级 memoryCache 常驻：先把 key 归零，用例之间才互不影响（不依赖执行顺序）
  await setDraftValue(JSON_DRAFT_KEY, { ...DEFAULT_JSON_DRAFT })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
  vi.clearAllMocks()
})

afterAll(async () => {
  // 语言是全局 i18next 实例上的状态，跑完必须还原成默认中文
  await i18n.changeLanguage('zh')
})

describe('JsonTool 输入 / 结果展示', () => {
  it('合法 JSON 点「格式化」后结果区渲染格式化文本，并显示大小与行数统计', async () => {
    await formatInput('{"b":1,"a":2}')

    expect(viewerText()).toBe('{\n  "b": 1,\n  "a": 2\n}')
    // 统计信息只在有结果时出现：4 行
    expect(container.textContent).toContain('4 行')
  })

  it('「填入示例」直接写入示例 JSON 并立即产出格式化结果', async () => {
    await renderTool()
    await act(async () => buttonByText('填入示例').click())

    expect(textarea().value).toContain('panda-dock')
    expect(viewerText()).toContain('"name": "panda-dock"')
    expect(container.querySelector('.tw-json-editor-wrap--empty-err')).toBeNull()
  })

  it('输入区可编辑、结果区只读：结果是 <pre> 高亮层，而不是可编辑表单', async () => {
    await renderTool()
    const input = textarea()
    expect(input.readOnly).toBe(false)

    await act(async () => setTextareaValue(input, '{"a":1}'))
    await act(async () => buttonByText('格式化').click())

    const viewer = container.querySelector('.tw-json__viewer')
    expect(viewer?.tagName).toBe('PRE')
    expect(viewer?.querySelector('textarea')).toBeNull()
    expect(viewer?.querySelector('input')).toBeNull()
    expect(viewer?.getAttribute('contenteditable')).toBeNull()
  })

  it('「清空」同时清掉输入、结果与草稿', async () => {
    await formatInput('{"a":1}')
    expect(viewerText()).toBe('{\n  "a": 1\n}')

    await act(async () => buttonByText('清空').click())

    expect(textarea().value).toBe('')
    expect(viewerText()).toBe('')
    const draft = await getDraftValue<typeof DEFAULT_JSON_DRAFT>(JSON_DRAFT_KEY)
    expect(draft?.input).toBe('')
    expect(draft?.output).toBe('')
  })
})

describe('JsonTool 单行压缩 / 键名排序 / 缩进', () => {
  it('勾选「单行压缩」后结果变为紧凑单行，缩进选择随之禁用；取消勾选恢复格式化', async () => {
    await formatInput('{"b":1,"a":2}')

    const minify = checkboxByLabel('单行压缩')
    await act(async () => minify.click())

    expect(viewerText()).toBe('{"b":1,"a":2}')
    expect(container.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true)

    await act(async () => minify.click())
    expect(viewerText()).toBe('{\n  "b": 1,\n  "a": 2\n}')
    expect(container.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(false)
  })

  it('勾选「键名排序」后按 A-Z 重排对象键（已有结果即时联动）', async () => {
    await formatInput('{"b":1,"a":2}')

    await act(async () => checkboxByLabel('键名排序').click())

    expect(viewerText()).toBe('{\n  "a": 2,\n  "b": 1\n}')
  })

  it('「转义」把 JSON 变成带外层引号的单行字符串，「去转义」再还原', async () => {
    await renderTool()
    await act(async () => setTextareaValue(textarea(), '{"a":1}'))

    await act(async () => buttonByText('转义').click())
    expect(viewerText()).toBe('"{\\"a\\":1}"')

    await act(async () => setTextareaValue(textarea(), viewerText()))
    await act(async () => buttonByText('去转义').click())
    expect(viewerText()).toBe('{\n  "a": 1\n}')
  })
})

describe('JsonTool 错误提示', () => {
  it('空输入点「格式化」：输入区加 empty-err 红框并聚焦，且不弹文字横幅', async () => {
    await renderTool()

    await act(async () => buttonByText('格式化').click())

    expect(container.querySelector('.tw-json-editor-wrap--empty-err')).not.toBeNull()
    expect(document.activeElement).toBe(textarea())
    // AGENTS §4 条 15：空输入只红框 + 聚焦，不留状态占位
    expect(container.querySelector('.tw-json__input-status')).toBeNull()

    await act(async () => setTextareaValue(textarea(), '{}'))
    expect(container.querySelector('.tw-json-editor-wrap--empty-err')).toBeNull()
  })

  it('非法 JSON 的错误提示紧贴操作栏下方，并标红出错行号', async () => {
    await formatInput('{"a": }')

    const actions = container.querySelector('.tw-json__actions')
    expect(actions?.nextElementSibling?.className).toContain('tw-json__input-status')
    expect(container.querySelector('.tw-json__input-status')?.textContent).toContain('解析失败')
    expect(viewerText()).toBe('')
    expect(container.querySelector('.tw-json-editor__ln--error')).not.toBeNull()
  })

  it('错误文案跟随语言：英文不含中文，切回中文含中文', async () => {
    await renderTool()
    await act(async () => setTextareaValue(textarea(), '{"a": }'))

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    await act(async () => buttonByText('Format').click())
    const enText = container.querySelector('.tw-json__input-status')?.textContent ?? ''
    expect(enText).toContain('JSON parse failed')
    expect(enText).not.toMatch(/[\u4e00-\u9fff]/)

    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    await act(async () => buttonByText('格式化').click())
    expect(container.querySelector('.tw-json__input-status')?.textContent).toMatch(
      /[\u4e00-\u9fff]/,
    )
  })
})

describe('JsonTool 复制 / 下载 / 草稿', () => {
  it('复制把格式化结果交给剪贴板并短暂显示「已复制」', async () => {
    await formatInput('{"a":1}')

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="复制"]')
    expect(copyButton).not.toBeNull()
    await act(async () => {
      copyButton?.click()
    })
    // 复制是异步的（copyText → onResult → setCopied），再放行一轮宏任务让「已复制」落进 DOM
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(vi.mocked(copyText)).toHaveBeenCalledWith('{\n  "a": 1\n}')
    // 复制成功后 Tooltip 文案变为「已复制」，按钮被包进 Tooltip（节点会被替换），必须重新查询
    expect(container.querySelector('button[aria-label="复制"]')?.textContent).toBe('已复制')
  })

  it('下载按钮把结果与 data.json 文件名交给 downloadText', async () => {
    await formatInput('{"a":1}')

    const downloadButton = container.querySelector<HTMLButtonElement>('.tw-json__download-link')
    expect(downloadButton).not.toBeNull()
    await act(async () => downloadButton?.click())

    expect(vi.mocked(downloadText)).toHaveBeenCalledWith('{\n  "a": 1\n}', 'data.json')
  })

  it('草稿 json.workbench 是对象：编辑后写入存储，重挂载能恢复输入与结果', async () => {
    await formatInput('{"b":1,"a":2}')

    // 让 useToolDraft 的防抖（200ms）把草稿真正落进（内存桩）会话存储
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 240))
    })
    const persisted = store[`panda.draft.${JSON_DRAFT_KEY}`] as
      | typeof DEFAULT_JSON_DRAFT
      | undefined
    expect(typeof persisted).toBe('object')
    expect(persisted).toMatchObject({
      input: '{"b":1,"a":2}',
      output: '{\n  "b": 1,\n  "a": 2\n}',
      lastAction: 'format',
      indent: 2,
    })

    // 卸载后重挂载（模拟切 Tab / 关抽屉再打开）：输入与结果都要回来
    act(() => root.unmount())
    root = createRoot(container)
    await renderTool()

    expect(textarea().value).toBe('{"b":1,"a":2}')
    expect(viewerText()).toBe('{\n  "b": 1,\n  "a": 2\n}')
  })
})

describe('JsonTool 的 Tab 缩进', () => {
  /** PdSelect 的下拉是 portal 到 body 的 */
  async function chooseIndent(label: string) {
    const combo = container.querySelector<HTMLButtonElement>('[role="combobox"]')
    if (!combo) throw new Error('未找到缩进选择器')
    await act(async () => combo.click())
    const option = [...document.body.querySelectorAll<HTMLElement>('[data-pds-item]')].find((el) =>
      el.textContent?.includes(label),
    )
    if (!option) throw new Error(`未找到缩进选项：${label}`)
    await act(async () => {
      option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
  }

  function pressTab(init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      ...init,
    })
    act(() => {
      textarea().dispatchEvent(event)
    })
    return event
  }

  it('行号栏编辑器：Tab 在光标处缩进并同步到受控输入', async () => {
    await renderTool()
    await act(async () => setTextareaValue(textarea(), '{}'))

    const el = textarea()
    act(() => el.setSelectionRange(0, 0))
    const event = pressTab()

    expect(event.defaultPrevented).toBe(true)
    expect(el.value).toBe('  {}')
    expect(el.selectionStart).toBe(2)
  })

  it('缩进单元跟随「缩进」设置（选 Tab 则插入制表符）', async () => {
    await renderTool()
    await act(async () => setTextareaValue(textarea(), '{}'))
    await chooseIndent('Tab')

    const el = textarea()
    act(() => el.setSelectionRange(0, 0))
    pressTab()

    expect(el.value).toBe('\t{}')
  })

  it('Ctrl+M 之后的 Tab 放行给焦点导航（抽屉里 Esc 被「关闭」占用时的等价出口）', async () => {
    await renderTool()
    await act(async () => setTextareaValue(textarea(), '{}'))

    act(() => {
      textarea().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true, cancelable: true }),
      )
    })
    const event = pressTab()

    expect(event.defaultPrevented).toBe(false)
    expect(textarea().value).toBe('{}')
    // 放行是一次性的：下一个 Tab 继续缩进
    expect(pressTab().defaultPrevented).toBe(true)
  })
})
