// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openOptionsPage, storageGet, storageRemove, storageSet } from './env'

/**
 * env.ts 有两处只有 DOM 环境才观察得到的降级行为：
 * 1. 打开设置页全失败后的最后一道 `window.open` 兜底；
 * 2. session 区在 chrome 缺失 / 调用抛错时改读写 `window.sessionStorage`。
 * vitest.config.ts 默认是 node 环境，所以这些用例单独放 happy-dom 文件。
 */

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

function stubChrome(api: unknown) {
  globalWithChrome.chrome = api
}

/** 模拟 content script：有 runtime（可发消息）、没有 tabs */
function stubRuntime(sendMessage: (message: unknown) => Promise<unknown>) {
  stubChrome({
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage },
  })
}

/** 只提供 session 区的部分实现，缺省动作一律不存在 */
function stubSessionArea(impl: { get?: () => Promise<unknown> } = {}) {
  stubChrome({
    storage: {
      session: {
        get: impl.get ?? (async () => ({})),
        set: async () => {},
        remove: async () => {},
      },
    },
  })
}

/**
 * happy-dom 的 `sessionStorage` / `window.open` 都挂在可配置的 getter 后面，
 * `vi.spyOn` 不能可靠还原（会污染同文件后续用例）。统一用 `vi.stubGlobal` 整块替换，
 * afterEach 的 `vi.unstubAllGlobals()` 会还原原始描述符。
 */
function stubSessionStorage(impl: {
  getItem?: (key: string) => string | null
  setItem?: (key: string, value: string) => void
  removeItem?: (key: string) => void
}) {
  vi.stubGlobal('sessionStorage', {
    getItem: impl.getItem ?? (() => null),
    setItem: impl.setItem ?? (() => {}),
    removeItem: impl.removeItem ?? (() => {}),
    clear: () => {},
  })
}

function stubWindowOpen(impl: () => unknown = () => null) {
  const open = vi.fn(impl)
  vi.stubGlobal('open', open)
  return open
}

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  delete globalWithChrome.chrome
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * content script 里 `window.open` 打开扩展页会被 Chrome 以 ERR_BLOCKED_BY_CLIENT 拦截，
 * 所以它只是「尽力而为」的最后兜底：不能因为失败而把异常抛给调用方。
 */
describe('openOptionsPage 的 window.open 兜底', () => {
  it('无 chrome 时完全静默，不开新窗口', async () => {
    const open = stubWindowOpen()
    await openOptionsPage()
    expect(open).not.toHaveBeenCalled()
  })

  it('tabs.create 与 background 都失败时用 window.open 打开 options.html', async () => {
    const open = stubWindowOpen()
    stubChrome({
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: async () => false,
      },
      tabs: {
        create: async () => {
          throw new Error('Cannot access a chrome:// URL')
        },
      },
    })
    await openOptionsPage()
    expect(open).toHaveBeenCalledWith('chrome-extension://test/options.html', '_blank')
  })

  it('background 抛错时同样落到 window.open', async () => {
    const open = stubWindowOpen()
    stubRuntime(async () => {
      throw new Error('Could not establish connection')
    })
    await openOptionsPage()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('background 返回 true 时不再开窗口（避免同时打开两个设置页）', async () => {
    const open = stubWindowOpen()
    stubRuntime(async () => true)
    await openOptionsPage()
    expect(open).not.toHaveBeenCalled()
  })

  it('window.open 自身被拦截时不冒泡', async () => {
    const open = stubWindowOpen(() => {
      throw new Error('blocked by popup blocker')
    })
    stubRuntime(async () => false)
    await expect(openOptionsPage()).resolves.toBeUndefined()
    // 兜底确实被尝试过（而不是被提前 return 跳过）
    expect(open).toHaveBeenCalledWith('chrome-extension://test/options.html', '_blank')
  })
})

/**
 * session 区是草稿的落点，网页预览（无 chrome）时必须还能用 sessionStorage 工作；
 * 但 sync / local 绝不允许误读 sessionStorage，否则会把会话草稿当成用户设置。
 */
describe('session 区的 sessionStorage 降级', () => {
  it('无 chrome 时从 sessionStorage 读回 JSON 值', async () => {
    window.sessionStorage.setItem('draft', JSON.stringify({ tab: 'decode' }))
    await expect(storageGet('session', 'draft')).resolves.toEqual({ tab: 'decode' })
  })

  it('chrome.storage.session 抛错时改用 sessionStorage', async () => {
    stubSessionArea({
      get: async () => {
        throw new Error('session area gone')
      },
    })
    window.sessionStorage.setItem('draft', JSON.stringify('fallback'))
    await expect(storageGet('session', 'draft')).resolves.toBe('fallback')
  })

  it('扩展环境可用时优先读 chrome.storage.session', async () => {
    stubSessionArea({ get: async () => ({ draft: 'from-chrome' }) })
    window.sessionStorage.setItem('draft', JSON.stringify('from-sessionStorage'))
    await expect(storageGet('session', 'draft')).resolves.toBe('from-chrome')
  })

  it('sessionStorage 里不是合法 JSON 时返回 null，不抛解析异常', async () => {
    window.sessionStorage.setItem('broken', '{not json')
    await expect(storageGet('session', 'broken')).resolves.toBeNull()
  })

  it('sessionStorage 里没有该 key 时返回 null', async () => {
    await expect(storageGet('session', 'missing')).resolves.toBeNull()
  })

  it('非 session 区不会误读 sessionStorage', async () => {
    window.sessionStorage.setItem('draft', JSON.stringify('web-draft'))
    await expect(storageGet('local', 'draft')).resolves.toBeNull()
    await expect(storageGet('sync', 'draft')).resolves.toBeNull()
  })

  it('无 chrome 时写入降级到 sessionStorage 并返回 true', async () => {
    await expect(storageSet('session', 'draft', { tab: 'encode' })).resolves.toBe(true)
    expect(window.sessionStorage.getItem('draft')).toBe(JSON.stringify({ tab: 'encode' }))
  })

  it('chrome 写入抛错时同样降级到 sessionStorage', async () => {
    stubChrome({
      storage: {
        session: {
          get: async () => ({}),
          set: async () => {
            throw new Error('QUOTA_BYTES quota exceeded')
          },
          remove: async () => {},
        },
      },
    })
    await expect(storageSet('session', 'draft', 'v')).resolves.toBe(true)
    expect(window.sessionStorage.getItem('draft')).toBe('"v"')
  })

  it('setItem 抛错（会话存储被禁用）时返回 false', async () => {
    stubSessionStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    await expect(storageSet('session', 'draft', 'v')).resolves.toBe(false)
  })

  it('非 session 区无 chrome 时写入返回 false 且不碰 sessionStorage', async () => {
    await expect(storageSet('local', 'draft', 'v')).resolves.toBe(false)
    expect(window.sessionStorage.getItem('draft')).toBeNull()
  })

  it('无 chrome 时删除降级到 sessionStorage 并返回 true', async () => {
    window.sessionStorage.setItem('draft', 'v')
    await expect(storageRemove('session', 'draft')).resolves.toBe(true)
    expect(window.sessionStorage.getItem('draft')).toBeNull()
  })

  it('chrome 删除抛错时同样降级到 sessionStorage', async () => {
    stubChrome({
      storage: {
        session: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {
            throw new Error('session area gone')
          },
        },
      },
    })
    window.sessionStorage.setItem('draft', 'v')
    await expect(storageRemove('session', 'draft')).resolves.toBe(true)
    expect(window.sessionStorage.getItem('draft')).toBeNull()
  })

  it('removeItem 抛错时返回 false', async () => {
    stubSessionStorage({
      removeItem: () => {
        throw new Error('SecurityError')
      },
    })
    await expect(storageRemove('session', 'draft')).resolves.toBe(false)
  })

  it('非 session 区无 chrome 时删除返回 false', async () => {
    await expect(storageRemove('sync', 'draft')).resolves.toBe(false)
    await expect(storageRemove('local', 'draft')).resolves.toBe(false)
  })
})
