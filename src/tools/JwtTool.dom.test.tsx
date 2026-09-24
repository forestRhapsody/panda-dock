// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

import { copyText } from '@/utils/clipboard'
import { setDraftValue } from '@/utils/draft'

import { SAMPLE_JWT, SAMPLE_SECRET } from './jwt'
import JwtTool from './JwtTool'

/**
 * JWT 工具的组件层行为：粘贴 → 解码 → header/payload 只读展示 + 标准声明（含过期提示）+ 复制。
 * 纯逻辑（decodeJwt / buildClaims / 过期文案）已有 jwt.test.ts，这里只验证 UI 接线与交互。
 */

vi.mock('@/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }))

// React 19 的 act 需要该标记
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let listeners: ChangeListener[]

function stubChrome() {
  const store: Record<string, unknown> = {}
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

/** 把任意 JSON 文本编码成 Base64URL 段 */
function b64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 造一个三段式 JWT（签名段固定，工具只解码不校验） */
function makeJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.c2ln`
}

const HEADER_TEXT = JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2)

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set
  nativeSetter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function tokenInput(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('textarea')
  if (!el) throw new Error('未找到 JWT 输入框')
  return el
}

function secretInput(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('.tw-jwt__verify-input')
  if (!el) throw new Error('未找到 Secret 输入框')
  return el
}

function setSecretValue(el: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  nativeSetter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === text,
  )
  if (!btn) throw new Error(`未找到按钮：${text}`)
  return btn
}

function field(label: string): HTMLDivElement {
  const el = [...container.querySelectorAll<HTMLDivElement>('.tw-field')].find((item) =>
    item.querySelector('.tw-field__label')?.textContent?.includes(label),
  )
  if (!el) throw new Error(`未找到字段：${label}`)
  return el
}

async function renderTool() {
  await act(async () => {
    root.render(<JwtTool />)
  })
}

async function decode(token: string) {
  await renderTool()
  await act(async () => setTextareaValue(tokenInput(), token))
  await act(async () => buttonByText('解码 →').click())
}

beforeEach(async () => {
  stubChrome()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // 草稿的模块级 memoryCache 常驻，先把 token 与 secret 归零
  await setDraftValue('jwt.token', '')
  await setDraftValue('jwt.secret', '')
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('JwtTool 解码展示', () => {
  it('三段式 JWT 解码后展示 header / payload，签名段为只读 pre', async () => {
    const payload = { sub: '1234567890', name: 'Panda Dock' }
    await decode(makeJwt(payload))

    const preList = container.querySelectorAll('.tw-json-hl')
    expect(preList[0].textContent).toBe(HEADER_TEXT)
    expect(preList[1].textContent).toBe(JSON.stringify(payload, null, 2))
    expect(container.textContent).toContain('Header')
    expect(container.textContent).toContain('Payload')

    const signatureField = field('签名 (Signature)')
    const signature = signatureField.querySelector('.tw-jwt__signature')
    expect(signature?.tagName).toBe('PRE')
    expect(signature?.textContent).toBe('c2ln')
    // 结果区全部只读：整棵子树里只有输入框一个 textarea
    expect(signatureField.querySelector('textarea')).toBeNull()
    expect(signatureField.querySelector('input')).toBeNull()
    expect(container.querySelectorAll('textarea')).toHaveLength(1)
  })

  it('兼容带 Bearer 前缀的粘贴内容', async () => {
    await decode(`Bearer ${makeJwt({ sub: 'bearer-user' })}`)

    expect(container.textContent).toContain('"sub": "bearer-user"')
    expect(container.textContent).toContain('Header')
  })

  it('「填入示例」写入示例 token 并直接解码', async () => {
    await renderTool()
    await act(async () => buttonByText('填入示例').click())

    expect(tokenInput().value).toBe(SAMPLE_JWT)
    expect(container.textContent).toContain('John Doe')
  })
})

describe('JwtTool 错误与空输入', () => {
  it('非法 token 的错误提示紧贴操作栏下方，且不渲染解码结果', async () => {
    await decode('abc')

    const actions = container.querySelector('.tw-actions')
    expect(actions?.nextElementSibling?.className).toContain('tw-status--err')
    expect(actions?.nextElementSibling?.textContent).toContain('三段')
    expect(actions?.nextElementSibling?.textContent).toContain('1 段')
    expect(container.querySelectorAll('.tw-json-hl')).toHaveLength(0)
    expect(container.querySelector('.tw-jwt__signature')).toBeNull()
  })

  it('空输入点「解码」：输入框加 empty-err 红框并聚焦，不弹文字横幅', async () => {
    await renderTool()

    await act(async () => buttonByText('解码 →').click())

    expect(tokenInput().className).toContain('tw-area--empty-err')
    expect(document.activeElement).toBe(tokenInput())
    expect(container.querySelector('.tw-status')).toBeNull()

    await act(async () => setTextareaValue(tokenInput(), 'x'))
    expect(tokenInput().className).not.toContain('tw-area--empty-err')
  })
})

describe('JwtTool 标准声明与过期时间', () => {
  it('exp 已过期：展示「已过期（N 天前）」并带 expired 高亮类', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    const nowSec = Math.floor(Date.now() / 1000)

    await decode(makeJwt({ sub: 'expired-user', exp: nowSec - 86400 * 3 }))

    expect(container.textContent).toContain('已过期（3 天前）')
    const hint = container.querySelector('.tw-jwt__time-hint')
    expect(hint?.className).toContain('tw-jwt__time-hint--expired')
  })

  it('exp 未过期：展示「剩余 N 天」且不标记为过期', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    const nowSec = Math.floor(Date.now() / 1000)

    await decode(makeJwt({ sub: 'fresh-user', exp: nowSec + 86400 * 5 }))

    expect(container.textContent).toContain('剩余 5 天')
    const hint = container.querySelector('.tw-jwt__time-hint')
    expect(hint).not.toBeNull()
    expect(hint?.className).not.toContain('tw-jwt__time-hint--expired')
  })

  it('标准声明按语义标签展示（iss / iat），并保留每个声明的复制按钮', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    const nowSec = Math.floor(Date.now() / 1000)

    await decode(makeJwt({ iss: 'panda-dock', iat: nowSec, sub: 's1' }))

    const claims = field('标准声明')
    expect(claims.textContent).toContain('签发者 (iss)')
    expect(claims.textContent).toContain('panda-dock')
    expect(claims.textContent).toContain('签发时间 (iat)')
    expect(claims.textContent).toContain('刚刚签发')
  })
})

describe('JwtTool 复制', () => {
  it('header 的复制按钮把 header JSON 文本交给剪贴板', async () => {
    await decode(makeJwt({ sub: 'copy-me' }))

    const headerCopy = field('Header').querySelector<HTMLButtonElement>('button[aria-label="复制"]')
    expect(headerCopy).not.toBeNull()
    await act(async () => {
      headerCopy?.click()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(vi.mocked(copyText)).toHaveBeenCalledWith(HEADER_TEXT)
    // 复制成功后按钮被 Tooltip 包裹替换，需重新查询
    expect(field('Header').querySelector('button[aria-label="复制"]')?.textContent).toBe('已复制')
  })
})

describe('JwtTool 签名验证 (HMAC)', () => {
  it('解码后默认展示签名验证输入框与待验证提示', async () => {
    await decode(SAMPLE_JWT)
    expect(container.textContent).toContain('签名校验 (HMAC)')
    expect(secretInput().value).toBe('')
    expect(container.textContent).toContain('请输入 Secret 校验签名')
  })

  it('点击「填入示例」同时填充示例 JWT 与 SAMPLE_SECRET，并展示验证通过状态', async () => {
    await renderTool()
    await act(async () => buttonByText('填入示例').click())

    expect(tokenInput().value).toBe(SAMPLE_JWT)
    expect(secretInput().value).toBe(SAMPLE_SECRET)

    // 等待 Web Crypto 异步验签完成
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(container.textContent).toContain('签名验证通过')
    expect(container.querySelector('.tw-jwt__verify-status--valid')).not.toBeNull()
  })

  it('输入错误的 Secret 时展示验证失败状态', async () => {
    await decode(SAMPLE_JWT)
    await act(async () => setSecretValue(secretInput(), 'wrong-secret'))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(container.textContent).toContain('签名验证失败（Secret 不匹配）')
    expect(container.querySelector('.tw-jwt__verify-status--invalid')).not.toBeNull()
  })

  it('清空按钮一并清空 Token、Secret 与验证状态', async () => {
    await renderTool()
    await act(async () => buttonByText('填入示例').click())

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(secretInput().value).toBe(SAMPLE_SECRET)

    await act(async () => buttonByText('清空').click())
    expect(tokenInput().value).toBe('')
    expect(container.querySelector('.tw-jwt__verify')).toBeNull()
  })
})

describe('JwtTool 的 Tab 缩进', () => {
  it('Tab 缩进不吞掉 Ctrl+Enter 执行', async () => {
    await renderTool()
    await act(async () => setTextareaValue(tokenInput(), SAMPLE_JWT))

    const el = tokenInput()
    act(() => el.setSelectionRange(0, 0))
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => {
      el.dispatchEvent(tab)
    })
    expect(tab.defaultPrevented).toBe(true)
    expect(el.value.startsWith('  ')).toBe(true)

    // 合并后的处理器仍要把 Ctrl+Enter 交给调用方（解码出结果）
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(container.textContent).toContain('签名校验 (HMAC)')
  })
})
