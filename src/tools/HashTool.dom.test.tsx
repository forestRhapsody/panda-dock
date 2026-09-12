// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { computeFileHash, HASH_FILE_MAX_BYTES } from '@/tools/hash'
import { setDraftValue } from '@/utils/draft'

import HashTool from './HashTool'

/**
 * HashTool 的纯逻辑（md5 / SHA 系列 / HMAC / 文件哈希 / 校验和比对）已有 hash.test.ts 覆盖。
 * 这里测组件层：文本自动计算的异步防抖、小写开关、HMAC 展开、文件 tab 的拖拽/结果/比对、
 * 计算失败与超限的错误提示、以及草稿对象的写入与恢复。
 *
 * 注意：源码里并没有「算法选择器（TkSelect）」——四种算法是同时渲染的，
 * 因此用「四个算法同时出现且与已知向量一致」来断言，而不是臆测一个不存在的下拉。
 */

// 只把 computeFileHash 包成可注入失败的 mock，其余纯函数保留真实实现
vi.mock('@/tools/hash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/hash')>()
  return { ...actual, computeFileHash: vi.fn(actual.computeFileHash) }
})

// React 19 的 act 需要该标记
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

const EMPTY_DRAFT = {
  tab: 'text',
  textInput: '',
  hmacKey: '',
  showHmac: false,
  uppercase: false,
  expectedChecksum: '',
}

/** 标准测试向量："abc" 与 RFC 4231 风格的 HMAC 向量（key = "key"） */
const ABC = {
  md5: '900150983cd24fb0d6963f7d28e17f72',
  sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  sha512:
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
}
const HMAC_MESSAGE = 'The quick brown fox jumps over the lazy dog'
const HMAC = {
  md5: '80070713463e7749b90c2dc24911e275',
  sha1: 'de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9',
  sha256: 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
  sha512:
    'b42af09057bac1e2d41708e48a902e09b5ff7f12ab428a4fe86653c73dd248fb82f948a549f7b791a5b41915ee4d1ec3935357e4e2317250d0372afa2ebeeb3a',
}

let store: Record<string, unknown>
let listeners: ChangeListener[]
let container: HTMLDivElement
let root: Root

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
const nativeInputValue = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value',
)?.set

function setAreaValue(el: HTMLTextAreaElement, value: string) {
  nativeAreaValue?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function setInputValue(el: HTMLInputElement, value: string) {
  nativeInputValue?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const card = () => container.firstElementChild as HTMLElement
/** 子节点顺序：[ToolTabs, 文本哈希区, 文件哈希区] */
const panel = (index: number) => card().children[index] as HTMLElement
const tabButtons = () =>
  [...card().querySelectorAll<HTMLButtonElement>('button[role="tab"]')] as HTMLButtonElement[]
const fieldValues = (scope: HTMLElement) =>
  [...scope.querySelectorAll('.tw-detect__field-value')].map((el) => el.textContent ?? '')

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
  await act(async () => {
    root.render(<HashTool />)
  })
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitFor(check: () => boolean, timeoutMs = 3000) {
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

async function typeText(text: string) {
  await act(async () => {
    setAreaValue(panel(1).querySelector('textarea') as HTMLTextAreaElement, text)
  })
}

/** 切到文件 tab 并拖入一个文件 */
async function dropFile(file: File) {
  await act(async () => {
    tabButtons()[1].click()
  })
  const drop = panel(2).querySelector('.tw-fileb64__drop') as HTMLElement
  await act(async () => {
    drop.dispatchEvent(dropEvent(file))
  })
}

beforeEach(async () => {
  stubChrome()
  await setDraftValue('hash', { ...EMPTY_DRAFT })
  vi.mocked(computeFileHash).mockClear()
  await i18n.changeLanguage('zh')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
  await i18n.changeLanguage('zh')
})

describe('HashTool 文本哈希', () => {
  it('空输入只显示引导提示，不产生结果也不出现空输入红框', async () => {
    await render()
    expect(panel(1).querySelector('.tw-status--info')?.textContent).toBe(
      '将自动计算 MD5 / SHA-1 / SHA-256 / SHA-512',
    )
    expect(panel(1).querySelector('.tw-detect__field')).toBeNull()
    expect((panel(1).querySelector('textarea') as HTMLTextAreaElement).className).not.toContain(
      'tw-area--empty-err',
    )
  })

  it('输入后防抖异步计算，四个算法同时展示且与已知向量一致', async () => {
    await render()
    await typeText('abc')
    // 防抖窗口内不同步出结果：计算是异步的，不阻塞输入
    expect(panel(1).querySelector('.tw-detect__field')).toBeNull()

    await waitFor(() => panel(1).querySelectorAll('.tw-detect__field').length === 4)
    expect(
      [...panel(1).querySelectorAll('.tw-detect__field-label')].map((el) => el.textContent),
    ).toEqual(['MD5', 'SHA-1', 'SHA-256', 'SHA-512'])
    const values = fieldValues(panel(1))
    expect(values).toEqual([ABC.md5, ABC.sha1, ABC.sha256, ABC.sha512])
    // 输出长度即算法位数（32/40/64/128 个 hex 字符）
    expect(values.map((v) => v.length)).toEqual([32, 40, 64, 128])
    // 源码没有 TkSelect 算法选择器，四种算法是并列渲染的
    expect(card().querySelector('.tk-select')).toBeNull()
  })

  it('大输入不阻塞主线程：输入当帧无结果，随后异步完成', async () => {
    await render()
    const big = 'a'.repeat(200_000)
    await typeText(big)
    expect(panel(1).querySelector('.tw-detect__field')).toBeNull()

    await waitFor(() => panel(1).querySelectorAll('.tw-detect__field').length === 4, 8000)
    const values = fieldValues(panel(1))
    expect(values[0]).toMatch(/^[0-9a-f]{32}$/)
    expect(values[2]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('小写开关默认勾选输出小写，取消勾选后就地转大写', async () => {
    await render()
    await typeText('abc')
    await waitFor(() => fieldValues(panel(1)).length === 4)

    const lowercase = panel(1).querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(lowercase.checked).toBe(true)
    expect(fieldValues(panel(1))[0]).toBe(ABC.md5)

    await act(async () => {
      lowercase.click()
    })
    expect(fieldValues(panel(1))).toEqual([
      ABC.md5.toUpperCase(),
      ABC.sha1.toUpperCase(),
      ABC.sha256.toUpperCase(),
      ABC.sha512.toUpperCase(),
    ])
    expect(lowercase.checked).toBe(false)

    await act(async () => {
      lowercase.click()
    })
    expect(fieldValues(panel(1))[0]).toBe(ABC.md5)
  })

  it('HMAC 开关展开密钥输入框，密钥参与计算后输出已知 HMAC 向量', async () => {
    await render()
    const boxes = panel(1).querySelectorAll('input[type="checkbox"]')
    await act(async () => {
      ;(boxes[1] as HTMLInputElement).click()
    })
    const keyInput = panel(1).querySelector('input.tw-input') as HTMLInputElement
    expect(keyInput).not.toBeNull()

    await act(async () => {
      setInputValue(keyInput, 'key')
    })
    await typeText(HMAC_MESSAGE)
    await waitFor(() => fieldValues(panel(1))[2] === HMAC.sha256)
    expect(fieldValues(panel(1))).toEqual([HMAC.md5, HMAC.sha1, HMAC.sha256, HMAC.sha512])
  })

  it('清空按钮重置文本与结果', async () => {
    await render()
    await typeText('abc')
    await waitFor(() => fieldValues(panel(1)).length === 4)
    await act(async () => {
      buttonWith(panel(1), '清空').click()
    })
    expect((panel(1).querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
    expect(panel(1).querySelector('.tw-detect__field')).toBeNull()
  })
})

describe('HashTool 文件哈希', () => {
  it('拖入文件后展示文件名/大小，结果与文本已知向量一致', async () => {
    await render()
    await dropFile(new File(['abc'], 'abc.txt', { type: 'text/plain' }))
    await waitFor(() => fieldValues(panel(2)).length === 4)
    expect(panel(2).querySelector('.tw-fileb64__filename')?.textContent).toBe('abc.txt')
    expect(panel(2).querySelector('.tw-fileb64__meta')?.textContent).toBe('3 B · text/plain')
    expect(fieldValues(panel(2))).toEqual([ABC.md5, ABC.sha1, ABC.sha256, ABC.sha512])
  })

  it('大小写切换按钮就地转换结果（hex ↔ HEX），无需重新读取文件', async () => {
    await render()
    await dropFile(new File(['abc'], 'abc.txt', { type: 'text/plain' }))
    await waitFor(() => fieldValues(panel(2)).length === 4)
    expect(buttonWith(panel(2), 'hex')).toBeTruthy()

    await act(async () => {
      buttonWith(panel(2), 'hex').click()
    })
    expect(fieldValues(panel(2))[0]).toBe(ABC.md5.toUpperCase())
    expect(buttonWith(panel(2), 'HEX')).toBeTruthy()

    await act(async () => {
      buttonWith(panel(2), 'HEX').click()
    })
    expect(fieldValues(panel(2))[0]).toBe(ABC.md5)
  })

  it('校验和比对：命中时提示算法并高亮对应行，不匹配时给出失败提示', async () => {
    await render()
    await dropFile(new File(['abc'], 'abc.txt', { type: 'text/plain' }))
    await waitFor(() => fieldValues(panel(2)).length === 4)

    await act(async () => {
      setInputValue(panel(2).querySelector('input.tw-input') as HTMLInputElement, ABC.sha256)
    })
    await waitFor(() => panel(2).querySelector('.tw-detect__field--matched') !== null)
    expect(panel(2).querySelector('.tw-status--ok')?.textContent).toBe(
      '与 SHA-256 校验和一致，文件未被修改',
    )
    expect(
      panel(2).querySelector('.tw-detect__field--matched .tw-detect__field-label')?.textContent,
    ).toBe('SHA-256')

    await act(async () => {
      setInputValue(panel(2).querySelector('input.tw-input') as HTMLInputElement, 'f'.repeat(64))
    })
    await waitFor(() => panel(2).querySelector('.tw-status--err') !== null)
    expect(panel(2).querySelector('.tw-status--err')?.textContent).toBe(
      '校验和不匹配，文件可能已损坏或被修改',
    )
    expect(panel(2).querySelector('.tw-detect__field--matched')).toBeNull()
  })

  it('计算抛错（如 Web Crypto 不可用）时展示错误状态', async () => {
    // 源码在 catch 里会 console.error，测试期间静音以免刷屏
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(computeFileHash).mockRejectedValueOnce(new Error('crypto unavailable'))
    await render()
    await dropFile(new File(['abc'], 'abc.txt', { type: 'text/plain' }))
    await waitFor(() => panel(2).querySelector('.tw-status--err') !== null)
    expect(panel(2).querySelector('.tw-status--err')?.textContent).toBe('crypto unavailable')
    expect(fieldValues(panel(2))).toHaveLength(0)
    errorSpy.mockRestore()
  })

  it('超过体积上限的文件被拒绝并显示上限提示', async () => {
    await render()
    const huge = {
      name: 'huge.bin',
      size: HASH_FILE_MAX_BYTES + 1,
      type: 'application/octet-stream',
    } as unknown as File
    await dropFile(huge)
    await waitFor(() => panel(2).querySelector('.tw-status--err') !== null)
    const err = panel(2).querySelector('.tw-status--err')?.textContent ?? ''
    expect(err).toContain('256.00 MB')
    expect(err).toContain('已停止计算')
    expect(fieldValues(panel(2))).toHaveLength(0)
  })

  it('清空按钮移除文件信息与结果，回到拖拽入口', async () => {
    await render()
    await dropFile(new File(['abc'], 'abc.txt', { type: 'text/plain' }))
    await waitFor(() => fieldValues(panel(2)).length === 4)
    await act(async () => {
      buttonWith(panel(2), '清空').click()
    })
    expect(panel(2).querySelector('.tw-fileb64__drop')).not.toBeNull()
    expect(fieldValues(panel(2))).toHaveLength(0)
  })
})

describe('HashTool 会话草稿', () => {
  it('草稿以对象结构写入 chrome.storage.session，重新挂载后恢复', async () => {
    await render()
    await typeText('abc')
    await act(async () => {
      const lowercase = panel(1).querySelector('input[type="checkbox"]') as HTMLInputElement
      lowercase.click()
    })
    await waitFor(
      () =>
        (store['toolkit.draft.hash'] as { uppercase?: boolean } | undefined)?.uppercase === true,
    )
    expect(store['toolkit.draft.hash']).toEqual({
      ...EMPTY_DRAFT,
      textInput: 'abc',
      uppercase: true,
    })

    // 卸载后直接写存储（不碰内存缓存），重挂载必须收敛到存储里的值
    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    store['toolkit.draft.hash'] = { ...EMPTY_DRAFT, textInput: 'restored-text', uppercase: true }
    await render()
    await flush()
    expect((panel(1).querySelector('textarea') as HTMLTextAreaElement).value).toBe('restored-text')
  })
})
