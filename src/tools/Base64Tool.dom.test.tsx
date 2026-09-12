// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { downloadDataUrl } from '@/tools/file'
import { setDraftValue } from '@/utils/draft'

import Base64Tool from './Base64Tool'

/**
 * Base64Tool 是四 Tab 的综合工具（文本解码 / 文本编码 / 文件转 Base64 / Base64 转文件）。
 * 纯逻辑（encodeBase64 / decodeBase64 / isLikelyBase64）已有 base64.test.ts 覆盖，
 * 这里只测组件层：Tab 状态机、useEmptyError 空输入红框、状态/错误提示位置、
 * 结果区只读、复制与下载接线、文件读写、以及草稿的写入结构与恢复。
 */

// 只替换下载函数、保留 fmtSize / detectMimeFromBytes 等真实实现：
// 断言按钮「确实调用了下载」即可，不需要真的触发浏览器下载。
vi.mock('@/tools/file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/file')>()
  return { ...actual, downloadDataUrl: vi.fn(actual.downloadDataUrl) }
})

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

/** 会话草稿基线：每个用例都从「四个 Tab 全空」开始，避免模块级 memoryCache 串味 */
const EMPTY_DRAFT = {
  tab: 'decode',
  decodeInput: '',
  decodeOutput: '',
  encodeInput: '',
  encodeOutput: '',
  fileB64Input: '',
}

let store: Record<string, unknown>
let listeners: ChangeListener[]
let container: HTMLDivElement
let root: Root

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(navigator),
  'clipboard',
)

/** 内存版 chrome.storage 桩：session/sync 都给，并带 runtime.id 让 isExtension() 为真 */
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

const card = () => container.firstElementChild as HTMLElement
/** 外层 tw-card 的子节点顺序固定为：[ToolTabs, 解码, 编码, 文件转Base64, Base64转文件] */
const panel = (index: number) => card().children[index] as HTMLElement
const tabButtons = () =>
  [...card().querySelectorAll<HTMLButtonElement>('button[role="tab"]')] as HTMLButtonElement[]
const textareas = (scope: HTMLElement) =>
  [...scope.querySelectorAll('textarea')] as HTMLTextAreaElement[]

function buttonWith(scope: HTMLElement, label: string): HTMLButtonElement {
  const btn = [...scope.querySelectorAll('button')].find((el) => el.textContent?.includes(label))
  if (!btn) throw new Error(`未找到按钮：${label}`)
  return btn as HTMLButtonElement
}

function dropEvent(file: File): Event {
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'dataTransfer', { value: { files: [file] } })
  return evt
}

async function render() {
  // 用 async act 让 useToolDraft 挂载时读取会话存储的 Promise 也落在 act 内
  await act(async () => {
    root.render(<Base64Tool />)
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

/** 在解码 Tab 输入并点击「解码 →」，返回解码面板 */
async function runDecode(text: string): Promise<HTMLElement> {
  const dp = panel(1)
  await act(async () => {
    setAreaValue(dp.querySelector('textarea') as HTMLTextAreaElement, text)
  })
  await act(async () => {
    buttonWith(panel(1), '解码 →').click()
  })
  return panel(1)
}

beforeEach(async () => {
  stubChrome()
  await setDraftValue('base64', { ...EMPTY_DRAFT })
  vi.mocked(downloadDataUrl).mockClear()
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
  await i18n.changeLanguage('zh')
})

describe('Base64Tool 的 Tab 状态机', () => {
  it('四个 Tab 初始只显示文本解码，切换后 hidden 与 aria-selected 正确翻转', async () => {
    await render()
    expect(tabButtons().map((b) => b.textContent)).toEqual([
      '文本解码',
      '文本编码',
      '文件转Base64',
      'Base64转文件',
    ])
    expect(tabButtons()[0].getAttribute('aria-selected')).toBe('true')
    expect(panel(1).hidden).toBe(false)
    expect([panel(2).hidden, panel(3).hidden, panel(4).hidden]).toEqual([true, true, true])

    await act(async () => {
      tabButtons()[1].click()
    })
    expect(panel(2).hidden).toBe(false)
    expect(panel(1).hidden).toBe(true)
    expect(tabButtons()[1].getAttribute('aria-selected')).toBe('true')
    expect(tabButtons()[0].getAttribute('aria-selected')).toBe('false')
  })

  it('文本解码与文本编码的输入/输出完全独立，切换 Tab 不串数据', async () => {
    await render()
    const dp = await runDecode('aGVsbG8=')
    expect(textareas(dp).map((a) => a.value)).toEqual(['aGVsbG8=', 'hello'])

    await act(async () => {
      tabButtons()[1].click()
    })
    const ep = panel(2)
    expect((ep.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')

    await act(async () => {
      setAreaValue(ep.querySelector('textarea') as HTMLTextAreaElement, 'hi')
    })
    await act(async () => {
      buttonWith(panel(2), '编码 →').click()
    })
    expect(textareas(panel(2)).map((a) => a.value)).toEqual(['hi', 'aGk='])

    await act(async () => {
      tabButtons()[0].click()
    })
    expect(textareas(panel(1)).map((a) => a.value)).toEqual(['aGVsbG8=', 'hello'])
  })
})

describe('Base64Tool 文本解码', () => {
  it('空输入点「解码 →」：输入框加红框并聚焦，且不弹文字横幅', async () => {
    await render()
    const dp = panel(1)
    await act(async () => {
      buttonWith(dp, '解码 →').click()
    })
    const area = panel(1).querySelector('textarea') as HTMLTextAreaElement
    expect(area.className).toContain('tw-area--empty-err')
    expect(document.activeElement).toBe(area)
    expect(panel(1).querySelector('.tw-status')).toBeNull()
    expect(textareas(panel(1))).toHaveLength(1)

    // 重新输入后红框自动清除（useEmptyError.clearEmpty 语义）
    await act(async () => {
      setAreaValue(area, 'aGVsbG8=')
    })
    expect((panel(1).querySelector('textarea') as HTMLTextAreaElement).className).not.toContain(
      'tw-area--empty-err',
    )
  })

  it('解码成功：结果只读、状态提示紧贴操作栏下方、结果在状态之后', async () => {
    await render()
    const dp = await runDecode('aGVsbG8=')
    const resultArea = textareas(dp)[1]
    expect(resultArea.value).toBe('hello')
    expect(resultArea.readOnly).toBe(true)
    expect(resultArea.className).toContain('tw-area--result')

    // 结果区不能出现可编辑控件（§4 第 16 条）
    const editableResults = textareas(dp).filter(
      (a) => a.className.includes('tw-area--result') && !a.readOnly,
    )
    expect(editableResults).toHaveLength(0)

    const status = dp.querySelector('.tw-status') as HTMLElement
    expect(status.className).toContain('tw-status--ok')
    expect(status.textContent).toBe('解码成功（UTF-8 文本）')
    const actions = dp.querySelector('.tw-actions') as HTMLElement
    expect(actions.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      status.compareDocumentPosition(resultArea) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('非法 Base64 报错并清空结果；中文包中文、英文包英文', async () => {
    await render()
    const dp = await runDecode('@@@')
    const status = dp.querySelector('.tw-status') as HTMLElement
    expect(status.className).toContain('tw-status--err')
    expect(status.textContent).toBe('无效的 Base64 格式')
    expect(status.textContent).toMatch(/[\u4e00-\u9fa5]/)
    expect(textareas(dp)).toHaveLength(1)

    // 切到英文后重新触发，错误文案必须随语言切换且不含中文
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    await act(async () => {
      buttonWith(panel(1), 'Decode →').click()
    })
    const en = panel(1).querySelector('.tw-status') as HTMLElement
    expect(en.textContent).toBe('Invalid Base64 format')
    expect(en.textContent).not.toMatch(/[\u4e00-\u9fa5]/)
  })

  it('URL-safe 与缺省 padding 的输入都能解码，非 UTF-8 字节给出二进制提示', async () => {
    await render()
    // 缺省 padding
    let dp = await runDecode('aGVsbG8')
    expect(textareas(dp)[1].value).toBe('hello')

    await act(async () => {
      buttonWith(panel(1), '清空').click()
    })
    // URL-safe 的 '//4='（字节 0xFF 0xFE）写作 '__4='
    dp = await runDecode('__4=')
    expect(dp.querySelector('.tw-status')?.textContent).toBe(
      '解码成功（非 UTF-8 内容，已按原始字节显示）',
    )
    expect(textareas(dp)[1].value).toBe(String.fromCharCode(0xff, 0xfe))
  })

  it('清空按钮重置输入、结果与状态', async () => {
    await render()
    await runDecode('aGVsbG8=')
    await act(async () => {
      buttonWith(panel(1), '清空').click()
    })
    const dp = panel(1)
    expect(textareas(dp)).toHaveLength(1)
    expect((dp.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
    expect(dp.querySelector('.tw-status')).toBeNull()
  })
})

describe('Base64Tool 文本编码', () => {
  it('空输入红框聚焦；输入后输出 Base64 并在状态里显示字符数', async () => {
    await render()
    await act(async () => {
      tabButtons()[1].click()
    })
    await act(async () => {
      buttonWith(panel(2), '编码 →').click()
    })
    const area = panel(2).querySelector('textarea') as HTMLTextAreaElement
    expect(area.className).toContain('tw-area--empty-err')
    expect(document.activeElement).toBe(area)

    await act(async () => {
      setAreaValue(area, 'hello')
    })
    await act(async () => {
      buttonWith(panel(2), '编码 →').click()
    })
    const out = textareas(panel(2))
    expect(out[0].value).toBe('hello')
    expect(out[1].value).toBe('aGVsbG8=')
    expect(out[1].readOnly).toBe(true)
    expect(panel(2).querySelector('.tw-status')?.textContent).toBe('已编码（UTF-8）：8 字符')
  })
})

describe('Base64Tool 复制接线', () => {
  it('点击复制把结果写入剪贴板，并短暂显示「已复制」', async () => {
    const writeText = vi.fn(async () => undefined)
    stubClipboard({ writeText })
    await render()
    const dp = await runDecode('aGVsbG8=')
    await act(async () => {
      buttonWith(dp, '复制').click()
    })
    await flush()
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(buttonWith(panel(1), '已复制')).toBeTruthy()
  })

  it('复制失败时在操作栏下方显示错误状态', async () => {
    stubClipboard({
      writeText: vi.fn(async () => {
        throw new Error('clipboard denied')
      }),
    })
    await render()
    const dp = await runDecode('aGVsbG8=')
    await act(async () => {
      buttonWith(dp, '复制').click()
    })
    await flush()
    const err = panel(1).querySelector('.tw-status--err') as HTMLElement
    expect(err.textContent).toBe('复制失败')
  })
})

describe('Base64Tool 文件转 Base64', () => {
  it('拖入文件后写入 Base64 / Data URL，并展示文件名与体积类型', async () => {
    await render()
    await act(async () => {
      tabButtons()[2].click()
    })
    const drop = panel(3).querySelector('.tw-fileb64__drop') as HTMLElement
    await act(async () => {
      drop.dispatchEvent(dropEvent(new File(['hello world'], 'hello.txt', { type: 'text/plain' })))
    })
    await waitFor(() => panel(3).querySelector('.tw-fileb64__filename') !== null)

    const fp = panel(3)
    expect(fp.querySelector('.tw-fileb64__filename')?.textContent).toBe('hello.txt')
    expect(fp.querySelector('.tw-fileb64__meta')?.textContent).toBe('11 B · text/plain')
    expect(textareas(fp).map((a) => a.value)).toEqual([
      'aGVsbG8gd29ybGQ=',
      'data:text/plain;base64,aGVsbG8gd29ybGQ=',
    ])
    expect(textareas(fp).every((a) => a.readOnly)).toBe(true)
  })

  it('超过 5MB 的文件被拒绝并给出错误提示，不进入读取流程', async () => {
    await render()
    await act(async () => {
      tabButtons()[2].click()
    })
    const huge = {
      name: 'huge.bin',
      size: 5 * 1024 * 1024 + 1,
      type: 'application/octet-stream',
    } as unknown as File
    const drop = panel(3).querySelector('.tw-fileb64__drop') as HTMLElement
    await act(async () => {
      drop.dispatchEvent(dropEvent(huge))
    })
    expect(panel(3).querySelector('.tw-status--err')?.textContent).toBe('文件超过 5MB 上限')
    expect(panel(3).querySelector('.tw-fileb64__drop')).not.toBeNull()
  })
})

describe('Base64Tool Base64 转文件', () => {
  it('解析 Data URL 的 MIME / 大小，下载按钮接线到 downloadDataUrl', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    await render()
    await act(async () => {
      tabButtons()[3].click()
    })
    const area = panel(4).querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      setAreaValue(area, 'iVBORw0KGgo=')
    })
    await waitFor(() => panel(4).querySelector('.tw-fileb64__result') !== null)

    const fp = panel(4)
    expect([...fp.querySelectorAll('.tw-detect__field-value')].map((el) => el.textContent)).toEqual(
      ['image/png', '8 B'],
    )

    await act(async () => {
      buttonWith(fp, '下载文件').click()
    })
    expect(vi.mocked(downloadDataUrl)).toHaveBeenCalledWith(
      'data:image/png;base64,iVBORw0KGgo=',
      'image.png',
    )
    createObjectURL.mockRestore()
  })

  it('非法 Base64 输入给出错误提示且不产生结果', async () => {
    await render()
    await act(async () => {
      tabButtons()[3].click()
    })
    const area = panel(4).querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      setAreaValue(area, '@@@')
    })
    await waitFor(() => panel(4).querySelector('.tw-status--err') !== null)
    expect(panel(4).querySelector('.tw-status--err')?.textContent).toBe(
      '无效的 Base64 / Data URL。',
    )
    expect(panel(4).querySelector('.tw-fileb64__result')).toBeNull()
  })

  it('从剪贴板粘贴：读到文本写入输入框并解析出结果', async () => {
    stubClipboard({ readText: vi.fn(async () => 'iVBORw0KGgo=') })
    await render()
    await act(async () => {
      tabButtons()[3].click()
    })
    await act(async () => {
      buttonWith(panel(4), '从剪贴板粘贴').click()
    })
    await waitFor(() => panel(4).querySelector('.tw-fileb64__result') !== null)
    expect((panel(4).querySelector('textarea') as HTMLTextAreaElement).value).toBe('iVBORw0KGgo=')
  })
})

describe('Base64Tool 会话草稿', () => {
  it('草稿以对象结构写入 chrome.storage.session，且各 Tab 的输入输出独立保留', async () => {
    await render()
    await act(async () => {
      setAreaValue(panel(1).querySelector('textarea') as HTMLTextAreaElement, 'aGVsbG8=')
    })
    await act(async () => {
      buttonWith(panel(1), '解码 →').click()
    })
    await waitFor(() => {
      const v = store['toolkit.draft.base64'] as typeof EMPTY_DRAFT | undefined
      return v?.decodeInput === 'aGVsbG8=' && v?.decodeOutput === 'hello'
    })
    expect(store['toolkit.draft.base64']).toEqual({
      ...EMPTY_DRAFT,
      decodeInput: 'aGVsbG8=',
      decodeOutput: 'hello',
    })

    await act(async () => {
      tabButtons()[1].click()
    })
    await act(async () => {
      setAreaValue(panel(2).querySelector('textarea') as HTMLTextAreaElement, 'hi')
    })
    await act(async () => {
      buttonWith(panel(2), '编码 →').click()
    })
    await waitFor(() => {
      const v = store['toolkit.draft.base64'] as typeof EMPTY_DRAFT | undefined
      return v?.encodeOutput === 'aGk='
    })
    expect(store['toolkit.draft.base64']).toEqual({
      tab: 'encode',
      decodeInput: 'aGVsbG8=',
      decodeOutput: 'hello',
      encodeInput: 'hi',
      encodeOutput: 'aGk=',
      fileB64Input: '',
    })
  })

  it('重新挂载能从会话存储恢复草稿（即使内存缓存里还是旧值）', async () => {
    await render()
    await act(async () => {
      setAreaValue(panel(1).querySelector('textarea') as HTMLTextAreaElement, 'draft-x')
    })
    await waitFor(
      () =>
        (store['toolkit.draft.base64'] as { decodeInput?: string } | undefined)?.decodeInput ===
        'draft-x',
    )

    // 卸载后只写会话存储、不碰内存缓存，模拟任何绕过 setDraftValue 的写入路径
    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    store['toolkit.draft.base64'] = {
      tab: 'encode',
      decodeInput: 'stale',
      decodeOutput: '',
      encodeInput: '你好',
      encodeOutput: '5L2g5aW9',
      fileB64Input: '',
    }

    await render()
    await flush()
    expect(panel(2).hidden).toBe(false)
    expect(panel(1).hidden).toBe(true)
    expect(textareas(panel(2)).map((a) => a.value)).toEqual(['你好', '5L2g5aW9'])
  })
})
