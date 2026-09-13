// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { clearDraftValue, setDraftValue } from '@/utils/draft'

import TimestampTool from './TimestampTool'

/**
 * TimestampTool 的解析逻辑（parseStamp / parseCustomDate / toLocalText / toRelative）已有 timestamp.test.ts 覆盖。
 * 这里测组件层：按钮触发的状态机（空输入红框、非法输入报错、结果行）、秒/毫秒来源识别、
 * 「当前时间」按钮用固定时钟断言、Ctrl/Cmd+Enter 快捷键、复制接线、以及字符串草稿的写入与恢复。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let store: Record<string, unknown>
let listeners: ChangeListener[]
let container: HTMLDivElement
let root: Root

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(navigator),
  'clipboard',
)

function stubChrome() {
  store = {}
  listeners = []
  const makeArea = () => ({
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]))
      Object.assign(store, obj)
      for (const listener of listeners) listener(changes, 'session')
    },
    remove: async (key: string) => {
      delete store[key]
    },
  })
  globalWithChrome.chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      session: makeArea(),
      sync: makeArea(),
      local: makeArea(),
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          listeners = listeners.filter((item) => item !== listener)
        },
      },
    },
  }
}

const nativeAreaValue = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype,
  'value',
)?.set

function setAreaValue(el: HTMLTextAreaElement, value: string) {
  nativeAreaValue?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

const DRAFT_KEY = 'panda.draft.timestamp.input'

const card = () => container.firstElementChild as HTMLElement
const area = () => card().querySelector('textarea') as HTMLTextAreaElement

function buttonWith(label: string): HTMLButtonElement {
  const btn = [...card().querySelectorAll('button')].find((el) => el.textContent?.includes(label))
  if (!btn) throw new Error(`未找到按钮：${label}`)
  return btn as HTMLButtonElement
}

function field(label: string): HTMLElement {
  const el = [...card().querySelectorAll('.tw-detect__field')].find(
    (f) => f.querySelector('.tw-detect__field-label')?.textContent === label,
  )
  if (!el) throw new Error(`未找到结果行：${label}`)
  return el as HTMLElement
}

const valueOf = (label: string) =>
  field(label).querySelector('.tw-detect__field-value')?.textContent ?? ''

async function render() {
  await act(async () => {
    root.render(<TimestampTool />)
  })
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待超时，当前文本：${container.textContent ?? ''}`)
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

async function setInput(text: string) {
  await act(async () => {
    setAreaValue(area(), text)
  })
}

async function convert(text: string) {
  await setInput(text)
  await act(async () => {
    buttonWith('转换 →').click()
  })
}

beforeEach(async () => {
  stubChrome()
  await setDraftValue('timestamp.input', '')
  await i18n.changeLanguage('zh')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  delete globalWithChrome.chrome
  vi.useRealTimers()
  await i18n.changeLanguage('zh')
})

describe('TimestampTool 初始状态与空输入', () => {
  it('初始不显示结果与状态，只显示输入提示', async () => {
    await render()
    expect(container.textContent).toContain('时间戳 / 日期')
    expect(card().querySelector('.tw-detect__field')).toBeNull()
    expect(card().querySelector('.tw-status')).toBeNull()
  })

  it('空输入点「转换 →」：输入框加红框并聚焦，不弹文字横幅', async () => {
    await render()
    await act(async () => {
      buttonWith('转换 →').click()
    })
    const input = area()
    expect(input.className).toContain('tw-area--empty-err')
    expect(document.activeElement).toBe(input)
    expect(card().querySelector('.tw-status')).toBeNull()
    expect(card().querySelector('.tw-detect__field')).toBeNull()

    await act(async () => {
      setAreaValue(input, '1735689600')
    })
    expect(area().className).not.toContain('tw-area--empty-err')
  })
})

describe('TimestampTool 解析与单位识别', () => {
  it('秒级时间戳：来源标签与 Unix 秒/毫秒/ISO/UTC 行正确', async () => {
    await render()
    await convert('1735689600')
    expect(card().querySelector('.tw-status--ok')?.textContent).toBe('按 Unix 秒解析')
    expect(valueOf('Unix 秒')).toBe('1735689600')
    expect(valueOf('Unix 毫秒')).toBe('1735689600000')
    expect(valueOf('ISO 8601')).toBe('2025-01-01T00:00:00.000Z')
    expect(valueOf('UTC 时间')).toBe('Wed, 01 Jan 2025 00:00:00 GMT')
  })

  it('毫秒级时间戳：来源标签切换为毫秒，结果仍指向同一时刻', async () => {
    await render()
    await convert('1735689600000')
    expect(card().querySelector('.tw-status--ok')?.textContent).toBe('按 Unix 毫秒解析')
    expect(valueOf('Unix 秒')).toBe('1735689600')
    expect(valueOf('Unix 毫秒')).toBe('1735689600000')
    expect(valueOf('ISO 8601')).toBe('2025-01-01T00:00:00.000Z')
  })

  it('日期文本（标准与中文格式）都能解析，本地时间行正确', async () => {
    await render()
    await convert('2025-01-01 12:00:00')
    expect(card().querySelector('.tw-status--ok')?.textContent).toBe('按日期文本解析')
    expect(valueOf('本地时间')).toBe('2025-01-01 12:00:00')
    expect(valueOf('Unix 秒')).toBe(
      String(Math.floor(new Date('2025-01-01 12:00:00').getTime() / 1000)),
    )

    await convert('2025年1月1日 15点30分')
    expect(card().querySelector('.tw-status--ok')?.textContent).toBe('按日期文本解析')
    expect(valueOf('本地时间')).toBe('2025-01-01 15:30:00')
  })

  it('非法输入显示错误且不产生结果，重新输入后错误清除', async () => {
    await render()
    await convert('hello world')
    expect(card().querySelector('.tw-status--err')?.textContent).toBe('无法识别该时间戳或日期格式')
    expect(card().querySelector('.tw-detect__field')).toBeNull()

    await setInput('1735689600')
    expect(card().querySelector('.tw-status--err')).toBeNull()
  })

  it('输入框内 Ctrl+Enter 直接触发转换', async () => {
    await render()
    await setInput('1735689600')
    await act(async () => {
      area().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      )
    })
    expect(valueOf('Unix 秒')).toBe('1735689600')
  })
})

describe('TimestampTool 当前时间', () => {
  it('「当前时间」用系统时间填充并立即转换（固定时钟）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
    await render()

    await act(async () => {
      buttonWith('当前时间').click()
    })
    expect(area().value).toBe('1735689600000')
    expect(card().querySelector('.tw-status--ok')?.textContent).toBe('按 Unix 毫秒解析')
    expect(valueOf('Unix 秒')).toBe('1735689600')
    expect(valueOf('相对现在')).toBe('刚刚')
  })
})

describe('TimestampTool 复制与结果只读', () => {
  it('结果行的复制按钮把该行值写入剪贴板', async () => {
    const writeText = vi.fn(async () => undefined)
    stubClipboard({ writeText })
    await render()
    await convert('1735689600')

    const copyBtn = field('ISO 8601').querySelector('button') as HTMLButtonElement
    await act(async () => {
      copyBtn.click()
    })
    await flush()
    expect(writeText).toHaveBeenCalledWith('2025-01-01T00:00:00.000Z')
  })

  it('结果区只读：结果以 code 展示，没有可编辑控件', async () => {
    await render()
    await convert('1735689600')
    const codes = [...card().querySelectorAll('.tw-detect__field-value')]
    expect(codes).toHaveLength(6)
    expect(codes.every((el) => el.tagName === 'CODE')).toBe(true)
    expect(card().querySelectorAll('textarea')).toHaveLength(1)
    expect(card().querySelectorAll('input')).toHaveLength(0)
  })
})

describe('TimestampTool 清空与草稿', () => {
  it('清空按钮重置输入/结果/错误并删除草稿', async () => {
    await render()
    await convert('1735689600')
    await waitFor(() => store[DRAFT_KEY] === '1735689600')

    await act(async () => {
      buttonWith('清空').click()
    })
    expect(area().value).toBe('')
    expect(card().querySelector('.tw-detect__field')).toBeNull()
    expect(card().querySelector('.tw-status')).toBeNull()
    await waitFor(() => !(DRAFT_KEY in store))
  })

  it('草稿以字符串写入 chrome.storage.session，重新挂载后恢复', async () => {
    await render()
    await convert('1735689600')
    await waitFor(() => store[DRAFT_KEY] === '1735689600')
    expect(typeof store[DRAFT_KEY]).toBe('string')

    // 卸载后直接写存储（不碰内存缓存），重挂载必须收敛到存储里的值
    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    store[DRAFT_KEY] = '9999999999'
    await render()
    await flush()
    expect(area().value).toBe('9999999999')
  })

  it('重挂载后自动补算上次的结果，不必再点一次「转换 →」', async () => {
    await render()
    await convert('1735689600')
    expect(valueOf('Unix 秒')).toBe('1735689600')

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    await render()
    await flush()

    expect(area().value).toBe('1735689600')
    expect(card().querySelector('.tw-status--ok')?.textContent).toBe('按 Unix 秒解析')
    expect(valueOf('Unix 秒')).toBe('1735689600')
  })

  it('只剩会话存储（如页面刷新）时同样会自动补算', async () => {
    // 内存缓存清空 + 只写存储：模拟新页面只读到会话存储
    await clearDraftValue('timestamp.input')
    store[DRAFT_KEY] = '1735689600'

    await render()
    await flush()

    expect(area().value).toBe('1735689600')
    expect(valueOf('Unix 秒')).toBe('1735689600')
  })

  it('补算只针对能解析成功的草稿：非法值重开时不无故弹出错误横幅', async () => {
    await clearDraftValue('timestamp.input')
    store[DRAFT_KEY] = '这不是时间'

    await render()
    await flush()

    expect(area().value).toBe('这不是时间')
    expect(card().querySelectorAll('.tw-detect__field')).toHaveLength(0)
    expect(card().querySelector('.tw-status')).toBeNull()
  })

  it('补算只发生一次：之后输入新值仍要手动点按钮才会更新结果', async () => {
    await render()
    await convert('1735689600')

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    await render()
    await flush()

    // 重开后改了输入但没点按钮：结果仍是上一次的，工具保持按钮触发式
    await setInput('9999999999')
    expect(area().value).toBe('9999999999')
    expect(valueOf('Unix 秒')).toBe('1735689600')
  })
})
