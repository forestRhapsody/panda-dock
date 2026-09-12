// @vitest-environment happy-dom
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import {
  MSG_GET_PAGE_URL,
  MSG_STORAGE_CLEAR,
  MSG_STORAGE_READ,
  MSG_STORAGE_REMOVE,
  MSG_STORAGE_SET,
} from '@/utils/messages'

import {
  clearStorageArea,
  installStorageBridge,
  isPageContext,
  listStorage,
  removeStorageKey,
  setStorageValue,
} from './storage'

/**
 * storage.ts 的「网页上下文」半边：直接读写 window.localStorage / sessionStorage。
 * 这些分支依赖真实的 window 与 Storage 对象（node 环境下没有 window），
 * 所以单独放 happy-dom 文件；扩展页 ↔ content 的桥接测试留在 storage.test.ts。
 */

const g = globalThis as unknown as { chrome?: unknown }

/** happy-dom 的 location 是只读属性，改 URL 必须走它自带的 setURL */
function setURL(url: string): void {
  const w = window as unknown as { happyDOM?: { setURL?: (u: string) => void } }
  if (!w.happyDOM?.setURL) throw new Error('happy-dom 未提供 setURL，无法切换页面上下文')
  w.happyDOM.setURL(url)
}

interface FakeStorage {
  length: number
  key(i: number): string | null
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
  clear(): void
}

function makeFakeStorage(entries: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

/**
 * 用 defineProperty 覆盖单个成员：真实 localStorage 很难造出 2000+ 键或抛错场景。
 * 传函数即「访问该成员时得到这个函数」，所以 `{ setItem: () => { throw … } }` 就等价于一个抛错的 setItem。
 */
function patchStorage(
  storage: FakeStorage,
  patch: Partial<Record<keyof FakeStorage, unknown>>,
): FakeStorage {
  for (const [name, value] of Object.entries(patch)) {
    Object.defineProperty(storage, name, { configurable: true, get: () => value })
  }
  return storage
}

function overrideStorage(name: 'localStorage' | 'sessionStorage', fake: FakeStorage): void {
  Object.defineProperty(window, name, { value: fake, configurable: true, writable: true })
}

/** 被替换前的原生 Storage 描述符，用例结束后原样还原，避免污染其它用例 */
let localDescriptor: PropertyDescriptor | undefined
let sessionDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  localDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
  sessionDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
  // 默认落在 https 网页上下文（isPageContext() === true）
  setURL('https://example.com/app')
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  if (localDescriptor) Object.defineProperty(window, 'localStorage', localDescriptor)
  if (sessionDescriptor) Object.defineProperty(window, 'sessionStorage', sessionDescriptor)
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete g.chrome
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

/** 断言失败结果并取出 error（成功时直接让用例失败） */
function failureError(result: { ok: true } | { ok: false; error: string }): string {
  if (result.ok) throw new Error('期望失败结果，实际返回成功')
  return result.error
}

describe('isPageContext：只有 http(s) 网页才允许直读页面存储', () => {
  it('http / https 网页为 true', () => {
    setURL('http://localhost:3000/x')
    expect(isPageContext()).toBe(true)
    setURL('https://example.com/app')
    expect(isPageContext()).toBe(true)
  })

  it('扩展页 / about: / file: 等非网页上下文为 false（这些页面读不到宿主页存储）', () => {
    for (const url of [
      'chrome-extension://abcdefghijklmnop/sidepanel.html',
      'about:blank',
      'file:///tmp/local.html',
      'data:text/html,hello',
    ]) {
      setURL(url)
      expect(isPageContext(), url).toBe(false)
    }
  })
})

describe('页面上下文直读：listStorage 生成快照', () => {
  it('列出真实键值、origin、totalCount，并区分 local / session 两个区域', async () => {
    window.localStorage.setItem('token', 'abc')
    window.localStorage.setItem('theme', 'dark')
    window.sessionStorage.setItem('draft', 'hello')

    const local = await listStorage('local')
    expect(local.ok).toBe(true)
    if (!local.ok) throw new Error('local 快照应成功')
    expect(local.data.origin).toBe('https://example.com')
    expect(local.data.area).toBe('local')
    expect(local.data.totalCount).toBe(2)
    expect(local.data.listTruncated).toBe(false)
    expect(local.data.entries).toEqual([
      { key: 'token', size: 3, value: 'abc', truncated: false },
      { key: 'theme', size: 4, value: 'dark', truncated: false },
    ])

    const session = await listStorage('session')
    expect(session.ok).toBe(true)
    if (!session.ok) throw new Error('session 快照应成功')
    expect(session.data.area).toBe('session')
    expect(session.data.entries.map((e) => e.key)).toEqual(['draft'])
  })

  it('size 用 UTF-8 字节数而不是字符数（多字节与 emoji 都要算对）', async () => {
    window.localStorage.setItem('cn', '中文')
    window.localStorage.setItem('emoji', '🙂')

    const res = await listStorage('local')
    if (!res.ok) throw new Error('快照应成功')
    const byKey = Object.fromEntries(res.data.entries.map((e) => [e.key, e.size]))
    // '中文' = 3 + 3 字节；'🙂' = 4 字节（代理对，字符串 length 只有 2）
    expect(byKey).toEqual({ cn: 6, emoji: 4 })
  })

  it('空存储返回空列表而不是报错', async () => {
    const res = await listStorage('local')
    if (!res.ok) throw new Error('空存储也应成功')
    expect(res.data).toEqual({
      origin: 'https://example.com',
      area: 'local',
      entries: [],
      totalCount: 0,
      listTruncated: false,
    })
  })

  it('单个值超过 8000 字符时截断内容并置 truncated=true（size 仍算全量字节）', async () => {
    window.localStorage.setItem('big', 'x'.repeat(8001))
    window.localStorage.setItem('edge', 'y'.repeat(8000))

    const res = await listStorage('local')
    if (!res.ok) throw new Error('快照应成功')
    const big = res.data.entries.find((e) => e.key === 'big')
    const edge = res.data.entries.find((e) => e.key === 'edge')
    expect(big).toEqual({ key: 'big', size: 8001, value: 'x'.repeat(8000), truncated: true })
    // 边界：正好 8000 字符不算截断
    expect(edge?.truncated).toBe(false)
    expect(edge?.value).toHaveLength(8000)
  })

  it('键数超过 2000 时只列前 2000 条并置 listTruncated=true', async () => {
    overrideStorage(
      'localStorage',
      patchStorage(makeFakeStorage(), {
        length: 2001,
        key: (i: number) => (i < 2001 ? `k${i}` : null),
        getItem: () => 'v',
      }),
    )

    const res = await listStorage('local')
    if (!res.ok) throw new Error('快照应成功')
    expect(res.data.totalCount).toBe(2001)
    expect(res.data.listTruncated).toBe(true)
    expect(res.data.entries).toHaveLength(2000)
    expect(res.data.entries[0].key).toBe('k0')
    expect(res.data.entries[1999].key).toBe('k1999')
  })

  it('store.key(i) 返回 null 的条目被跳过，但 totalCount 仍按 store.length 计', async () => {
    overrideStorage(
      'localStorage',
      patchStorage(makeFakeStorage(), {
        length: 3,
        key: (i: number) => [null, 'a', 'b'][i] ?? null,
        getItem: (k: string) => `${k}!`,
      }),
    )

    const res = await listStorage('local')
    if (!res.ok) throw new Error('快照应成功')
    expect(res.data.totalCount).toBe(3)
    expect(res.data.entries).toEqual([
      { key: 'a', size: 2, value: 'a!', truncated: false },
      { key: 'b', size: 2, value: 'b!', truncated: false },
    ])
  })

  it('读取被浏览器拒绝（SecurityError）时返回 { ok:false, error } 而不是抛错', async () => {
    overrideStorage(
      'localStorage',
      patchStorage(makeFakeStorage({ a: '1' }), {
        getItem: () => {
          throw new Error('SecurityError: storage is not available')
        },
      }),
    )

    const res = await listStorage('local')
    expect(failureError(res)).toContain('SecurityError')
  })
})

describe('页面上下文直写：setStorageValue / removeStorageKey / clearStorageArea', () => {
  it('写入落到指定区域，且不影响另一个区域', async () => {
    await expect(setStorageValue('local', 'k', 'v')).resolves.toEqual({ ok: true })
    await expect(setStorageValue('session', 's', 'sv')).resolves.toEqual({ ok: true })

    expect(window.localStorage.getItem('k')).toBe('v')
    expect(window.sessionStorage.getItem('k')).toBeNull()
    expect(window.sessionStorage.getItem('s')).toBe('sv')
    expect(window.localStorage.getItem('s')).toBeNull()
  })

  it('删除只删指定 key，其余键保留', async () => {
    window.localStorage.setItem('a', '1')
    window.localStorage.setItem('b', '2')

    await expect(removeStorageKey('local', 'a')).resolves.toEqual({ ok: true })
    expect(window.localStorage.getItem('a')).toBeNull()
    expect(window.localStorage.getItem('b')).toBe('2')
  })

  it('清空只作用于指定区域', async () => {
    window.localStorage.setItem('a', '1')
    window.sessionStorage.setItem('s', '1')

    await expect(clearStorageArea('local')).resolves.toEqual({ ok: true })
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.getItem('s')).toBe('1')
  })

  it('写入超配额（QuotaExceededError）时返回 { ok:false, error } 而不是抛错', async () => {
    overrideStorage(
      'localStorage',
      patchStorage(makeFakeStorage(), {
        setItem: () => {
          throw new Error('QuotaExceededError: quota exceeded')
        },
      }),
    )

    const res = await setStorageValue('local', 'k', 'v')
    expect(failureError(res)).toContain('QuotaExceededError')
  })

  it('删除 / 清空被拒绝时同样转成失败结果', async () => {
    const denied = () =>
      patchStorage(makeFakeStorage(), {
        removeItem: () => {
          throw new Error('SecurityError: removeItem denied')
        },
        clear: () => {
          throw new Error('SecurityError: clear denied')
        },
      })

    overrideStorage('localStorage', denied())
    expect(failureError(await removeStorageKey('local', 'a'))).toContain('SecurityError')

    overrideStorage('localStorage', denied())
    expect(failureError(await clearStorageArea('local'))).toContain('SecurityError')
  })
})

/** installStorageBridge 是 content script 侧的实现：扩展页发出的存储请求由它代读代写 */
type BridgeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => unknown

interface BridgeCall {
  responses: unknown[]
  returned: unknown
}

function installBridgeWithChrome(): BridgeListener[] {
  const listeners: BridgeListener[] = []
  g.chrome = {
    runtime: {
      id: 'test-ext',
      onMessage: { addListener: (fn: BridgeListener) => void listeners.push(fn) },
    },
  }
  installStorageBridge()
  return listeners
}

function callListener(listener: BridgeListener, message: unknown): BridgeCall {
  const responses: unknown[] = []
  const returned = listener(message, {}, (response) => void responses.push(response))
  return { responses, returned }
}

/** 从快照响应里取出 key/size 列表，省去每处的类型收窄样板 */
function entriesOf(response: unknown): { key: string; size: number }[] {
  const entries = (response as { data: { entries: { key: string; size: number }[] } }).data.entries
  return entries.map((e) => ({ key: e.key, size: e.size }))
}

describe('installStorageBridge：content script 侧的存储桥接', () => {
  it('无 chrome（dev 预览 / 单测默认环境）时安全返回，不注册任何监听', () => {
    // 前置断言：当前确实没有 chrome，否则这个用例证明不了降级路径
    expect(g.chrome).toBeUndefined()
    expect(() => installStorageBridge()).not.toThrow()
    expect(g.chrome).toBeUndefined()
  })

  it('chrome.runtime.onMessage 缺失时同样安全返回', () => {
    g.chrome = { runtime: { id: 'test-ext' } }
    expect(() => installStorageBridge()).not.toThrow()
    expect(Object.keys((g.chrome as { runtime: object }).runtime)).toEqual(['id'])
  })

  it('注册监听后，MSG_GET_PAGE_URL 返回当前页面实时网址', () => {
    const listeners = installBridgeWithChrome()
    expect(listeners).toHaveLength(1)

    setURL('https://example.com/other?x=1#h')
    expect(callListener(listeners[0], { action: MSG_GET_PAGE_URL })).toEqual({
      responses: [{ ok: true, url: 'https://example.com/other?x=1#h' }],
      returned: undefined,
    })
  })

  it('MSG_STORAGE_READ 按 area 读取；area 缺省或非法时回退 local', () => {
    window.localStorage.setItem('l', '1')
    window.sessionStorage.setItem('s', '2')
    const listeners = installBridgeWithChrome()

    const readLocal = callListener(listeners[0], { action: MSG_STORAGE_READ, area: 'local' })
    const readSession = callListener(listeners[0], { action: MSG_STORAGE_READ, area: 'session' })
    const readDefault = callListener(listeners[0], { action: MSG_STORAGE_READ })
    const readBogus = callListener(listeners[0], { action: MSG_STORAGE_READ, area: 'nope' })

    for (const call of [readLocal, readDefault, readBogus]) {
      const res = call.responses[0] as { ok: boolean; data: { area: string } }
      expect(res.ok).toBe(true)
      expect(res.data.area).toBe('local')
      expect(entriesOf(call.responses[0])).toEqual([{ key: 'l', size: 1 }])
    }
    const sessionRes = readSession.responses[0] as { data: { area: string } }
    expect(sessionRes.data.area).toBe('session')
    expect(entriesOf(readSession.responses[0])).toEqual([{ key: 's', size: 1 }])
  })

  it('MSG_STORAGE_REMOVE 缺少 key 时给出本地化的 errorMissingKey，且不删除任何键', async () => {
    window.localStorage.setItem('keep', '1')
    const listeners = installBridgeWithChrome()

    await i18n.changeLanguage('zh')
    const zhCall = callListener(listeners[0], { action: MSG_STORAGE_REMOVE, area: 'local' })
    expect(zhCall.responses).toEqual([{ ok: false, error: i18n.t('tool.storage.errorMissingKey') }])
    expect(CJK.test((zhCall.responses[0] as { error: string }).error)).toBe(true)
    // 空串与 undefined 走同一条「缺 key」分支
    expect(callListener(listeners[0], { action: MSG_STORAGE_REMOVE, key: '' }).responses).toEqual([
      { ok: false, error: i18n.t('tool.storage.errorMissingKey') },
    ])
    expect(window.localStorage.getItem('keep')).toBe('1')

    await i18n.changeLanguage('en')
    const enCall = callListener(listeners[0], { action: MSG_STORAGE_REMOVE, key: undefined })
    const enError = (enCall.responses[0] as { error: string }).error
    expect(enError).toBe(i18n.t('tool.storage.errorMissingKey'))
    expect(CJK.test(enError)).toBe(false)
  })

  it('MSG_STORAGE_REMOVE 按 area 删除指定 key', () => {
    window.localStorage.setItem('a', '1')
    window.localStorage.setItem('b', '2')
    window.sessionStorage.setItem('s', '1')
    const listeners = installBridgeWithChrome()

    expect(
      callListener(listeners[0], { action: MSG_STORAGE_REMOVE, area: 'local', key: 'a' }),
    ).toEqual({ responses: [{ ok: true }], returned: undefined })
    expect(window.localStorage.getItem('a')).toBeNull()
    expect(window.localStorage.getItem('b')).toBe('2')

    callListener(listeners[0], { action: MSG_STORAGE_REMOVE, area: 'session', key: 's' })
    expect(window.sessionStorage.getItem('s')).toBeNull()
  })

  it('MSG_STORAGE_SET 写入 key/value；value 缺省与 null 都写成空串', () => {
    const listeners = installBridgeWithChrome()

    expect(
      callListener(listeners[0], { action: MSG_STORAGE_SET, area: 'local', key: 'a', value: '1' }),
    ).toEqual({ responses: [{ ok: true }], returned: undefined })
    expect(window.localStorage.getItem('a')).toBe('1')

    callListener(listeners[0], { action: MSG_STORAGE_SET, key: 'empty' })
    expect(window.localStorage.getItem('empty')).toBe('')
    callListener(listeners[0], { action: MSG_STORAGE_SET, area: 'nope', key: 'nil', value: null })
    expect(window.localStorage.getItem('nil')).toBe('')
  })

  it('MSG_STORAGE_SET 缺少 key 时给出本地化错误且不写入', async () => {
    const listeners = installBridgeWithChrome()

    await i18n.changeLanguage('en')
    const call = callListener(listeners[0], { action: MSG_STORAGE_SET, value: 'x' })
    expect(call.responses).toEqual([{ ok: false, error: i18n.t('tool.storage.errorMissingKey') }])
    expect(window.localStorage.length).toBe(0)
  })

  it('MSG_STORAGE_CLEAR 清空指定区域，area 非法时落到 local', () => {
    window.localStorage.setItem('l', '1')
    window.sessionStorage.setItem('s', '2')
    const listeners = installBridgeWithChrome()

    callListener(listeners[0], { action: MSG_STORAGE_CLEAR, area: 'nope' })
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.getItem('s')).toBe('2')

    callListener(listeners[0], { action: MSG_STORAGE_CLEAR, area: 'session' })
    expect(window.sessionStorage.length).toBe(0)
  })

  it('未知 action / 非法消息不响应也不抛错（监听器必须保持静默）', () => {
    const listener = installBridgeWithChrome()[0]

    expect(callListener(listener, { action: 'NOT_A_REAL_ACTION' })).toEqual({
      responses: [],
      returned: undefined,
    })
    expect(callListener(listener, null)).toEqual({ responses: [], returned: undefined })
    expect(callListener(listener, undefined)).toEqual({ responses: [], returned: undefined })
    expect(callListener(listener, 'oops')).toEqual({ responses: [], returned: undefined })
  })

  it('底层存储抛错时回以 { ok:false, error }，不把异常抛回消息通道', () => {
    const listeners = installBridgeWithChrome()
    overrideStorage(
      'localStorage',
      patchStorage(makeFakeStorage({ a: '1' }), {
        getItem: () => {
          throw new Error('SecurityError: denied')
        },
        removeItem: () => {
          throw new Error('SecurityError: denied')
        },
      }),
    )

    const read = callListener(listeners[0], { action: MSG_STORAGE_READ, area: 'local' })
    expect(read.responses).toEqual([{ ok: false, error: 'SecurityError: denied' }])

    const removed = callListener(listeners[0], {
      action: MSG_STORAGE_REMOVE,
      area: 'local',
      key: 'a',
    })
    expect(removed.responses).toEqual([{ ok: false, error: 'SecurityError: denied' }])
  })
})
