import { afterEach, describe, expect, it, vi } from 'vitest'

import pkg from '../../package.json'
import {
  extVersion,
  isExtension,
  openOptionsPage,
  storageGet,
  storageRemove,
  storageSet,
} from './env'
import { MSG_OPEN_OPTIONS } from './messages'

/**
 * `storageSet` 的失败信号是 T133 的基础：`chrome.storage.sync` 有单条 8KB 与写入频率配额，
 * 失败时它只返回 false（不抛错），调用方必须据此提示用户，否则用户会以为设置已保存。
 */
/** 用 unknown 断开与 @types/chrome 的强类型绑定：这里只需要一个「可写可删」的桩 */
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

function stubChrome(
  impl: {
    get?: (key: string) => Promise<Record<string, unknown>>
    set?: (obj: Record<string, unknown>) => Promise<void>
    remove?: (key: string) => Promise<void>
  } = {},
) {
  const area = {
    get: impl.get ?? (async () => ({})),
    set: impl.set ?? (async () => {}),
    remove: impl.remove ?? (async () => {}),
  }
  globalWithChrome.chrome = { storage: { sync: area, local: area, session: area } }
}

/** 只桩 chrome.storage 三区，缺省的 API 一律不存在——用于验证「缺失 API 也不裸调」 */
function stubPartialStorage(areas: Record<string, unknown>) {
  globalWithChrome.chrome = { storage: areas }
}

afterEach(() => {
  delete globalWithChrome.chrome
  vi.restoreAllMocks()
})

describe('storageSet / storageGet / storageRemove 的失败信号', () => {
  it('写入成功返回 true', async () => {
    stubChrome({})
    await expect(storageSet('sync', 'settings', { a: 1 })).resolves.toBe(true)
  })

  it('底层拒绝（如配额已满）时返回 false，而不是抛错', async () => {
    stubChrome({
      set: async () => {
        throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded')
      },
    })
    await expect(storageSet('sync', 'settings', { a: 1 })).resolves.toBe(false)
  })

  it('非扩展环境（无 chrome）返回 false 且不抛错', async () => {
    await expect(storageSet('sync', 'settings', { a: 1 })).resolves.toBe(false)
    await expect(storageSet('local', 'ballImage', null)).resolves.toBe(false)
  })

  it('读取与删除同样在失败时分别给出 null / false', async () => {
    const boom = async () => {
      throw new Error('boom')
    }
    stubChrome({ get: boom, set: boom, remove: boom })
    await expect(storageGet('sync', 'settings')).resolves.toBeNull()
    await expect(storageRemove('sync', 'settings')).resolves.toBe(false)
  })

  it('读取成功时返回存储值', async () => {
    stubChrome({ get: async () => ({ settings: { theme: 'dark' } }) })
    await expect(storageGet('sync', 'settings')).resolves.toEqual({ theme: 'dark' })
  })
})

/**
 * 是否处于真实扩展环境决定了能不能裸调 `chrome.*`（AGENTS.md §4 第 4 条），
 * 一旦这里误判为 true，`pnpm dev` 预览就会在每个调用点崩掉。
 */
describe('isExtension 的环境判定', () => {
  it('没有 chrome 全局时为非扩展环境', () => {
    expect(isExtension()).toBe(false)
  })

  it('chrome 存在但没有 runtime（dev 里的空壳）时为非扩展环境', () => {
    globalWithChrome.chrome = {}
    expect(isExtension()).toBe(false)
  })

  it('runtime 存在但 id 为空串时为非扩展环境', () => {
    globalWithChrome.chrome = { runtime: { id: '' } }
    expect(isExtension()).toBe(false)
  })

  it('runtime.id 有值时为扩展环境', () => {
    globalWithChrome.chrome = { runtime: { id: 'abcdefghijklmnop' } }
    expect(isExtension()).toBe(true)
  })
})

/**
 * 版本号会显示在 UI 上，任何取不到的情况都必须给占位值；
 * 空串与 null/undefined 一样属于「取不到」，不能把空白版本号渲染给用户。
 */
describe('extVersion 的取值与降级', () => {
  it('无 chrome 时返回占位版本号', () => {
    expect(extVersion()).toBe(pkg.version)
  })

  it('getManifest 抛错时回退占位版本号', () => {
    globalWithChrome.chrome = {
      runtime: {
        getManifest: () => {
          throw new Error('manifest unavailable')
        },
      },
    }
    expect(extVersion()).toBe(pkg.version)
  })

  it('getManifest 缺失（旧内核/测试桩）时回退占位版本号', () => {
    globalWithChrome.chrome = { runtime: {} }
    expect(extVersion()).toBe(pkg.version)
  })

  it('getManifest 正常返回时取真实版本号', () => {
    globalWithChrome.chrome = { runtime: { getManifest: () => ({ version: '1.4.2' }) } }
    expect(extVersion()).toBe('1.4.2')
  })

  it('version 为 null / undefined 时回退占位版本号', () => {
    globalWithChrome.chrome = { runtime: { getManifest: () => ({ version: null }) } }
    expect(extVersion()).toBe(pkg.version)
    globalWithChrome.chrome = { runtime: { getManifest: () => ({}) } }
    expect(extVersion()).toBe(pkg.version)
  })

  it('version 为空串时同样回退占位版本号（空串视为取不到）', () => {
    globalWithChrome.chrome = { runtime: { getManifest: () => ({ version: '' }) } }
    expect(extVersion()).toBe(pkg.version)
  })
})

/**
 * 打开设置页有三条路径，优先级不能乱：扩展页直接开标签，content script 经 background，
 * 最后才 window.open。window.open 兜底本身在 env.dom.test.ts 里验证，这里验证前两条的出入口。
 */
describe('openOptionsPage 的路径优先级', () => {
  it('有 chrome.tabs 时优先开新标签，且不再打扰 background', async () => {
    const create = vi.fn(async () => ({}))
    const sendMessage = vi.fn(async () => true)
    globalWithChrome.chrome = {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage },
      tabs: { create },
    }
    await openOptionsPage()
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://test/options.html' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('tabs.create 抛错后改用 background 的 MSG_OPEN_OPTIONS', async () => {
    const create = vi.fn(async () => {
      throw new Error('Cannot access contents of the page')
    })
    const sendMessage = vi.fn(async () => true)
    globalWithChrome.chrome = {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage },
      tabs: { create },
    }
    await expect(openOptionsPage()).resolves.toBeUndefined()
    expect(sendMessage).toHaveBeenCalledWith({ action: MSG_OPEN_OPTIONS })
  })

  it('content script 没有 chrome.tabs 时直接经 background 打开', async () => {
    const sendMessage = vi.fn(async () => true)
    globalWithChrome.chrome = {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage },
    }
    await openOptionsPage()
    expect(sendMessage).toHaveBeenCalledWith({ action: MSG_OPEN_OPTIONS })
  })

  it('background 抛错时不冒泡（留给 window.open 兜底）', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('Could not establish connection')
    })
    globalWithChrome.chrome = {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage },
    }
    await expect(openOptionsPage()).resolves.toBeUndefined()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

/** 三个存储区的调用形态一致，逐个区域验证可以挡住「只处理了 sync」这类回归 */
describe('storageGet 的三区读取', () => {
  it.each(['sync', 'local', 'session'] as const)('%s 区命中 key 时返回原值', async (area) => {
    stubChrome({ get: async (key) => ({ [key]: { theme: 'dark' } }) })
    await expect(storageGet(area, 'settings')).resolves.toEqual({ theme: 'dark' })
  })

  it('底层返回空对象（key 不存在）时得到 null', async () => {
    stubChrome({})
    await expect(storageGet('local', 'missing')).resolves.toBeNull()
  })

  it('底层返回 { key: undefined } 时同样归一化为 null', async () => {
    stubChrome({ get: async (key) => ({ [key]: undefined }) })
    await expect(storageGet('session', 'draft')).resolves.toBeNull()
  })

  it.each(['sync', 'local'] as const)(
    '%s 区底层抛错且无 sessionStorage 时返回 null',
    async (area) => {
      stubChrome({
        get: async () => {
          throw new Error('storage unavailable')
        },
      })
      await expect(storageGet(area, 'settings')).resolves.toBeNull()
    },
  )

  it('session 区底层抛错、当前环境也没有 window 时仍返回 null', async () => {
    stubChrome({
      get: async () => {
        throw new Error('session area gone')
      },
    })
    await expect(storageGet('session', 'draft')).resolves.toBeNull()
  })

  it('无 chrome 时 sync / local 区返回 null（不会误读网页存储）', async () => {
    await expect(storageGet('sync', 'settings')).resolves.toBeNull()
    await expect(storageGet('local', 'ballImage')).resolves.toBeNull()
  })

  it('chrome.storage 缺失时返回 null，不抛错', async () => {
    globalWithChrome.chrome = { runtime: { id: 'abcdefghijklmnop' } }
    await expect(storageGet('sync', 'settings')).resolves.toBeNull()
  })

  it('只注册了 session 区时，sync / local 读取返回 null', async () => {
    stubPartialStorage({ session: { get: async () => ({ draft: 'v' }) } })
    await expect(storageGet('sync', 'draft')).resolves.toBeNull()
    await expect(storageGet('local', 'draft')).resolves.toBeNull()
    await expect(storageGet('session', 'draft')).resolves.toBe('v')
  })
})

describe('storageSet 的三区写入', () => {
  it.each(['sync', 'local', 'session'] as const)('%s 区写入成功返回 true', async (area) => {
    stubChrome({})
    await expect(storageSet(area, 'settings', { a: 1 })).resolves.toBe(true)
  })

  it('写入时以 { key: value } 的形态传给底层 API', async () => {
    const set = vi.fn(async () => {})
    stubChrome({ set })
    await storageSet('local', 'ballImage', 'data:image/png;base64,AAAA')
    expect(set).toHaveBeenCalledWith({ ballImage: 'data:image/png;base64,AAAA' })
  })

  it.each(['sync', 'local'] as const)('%s 区底层抛错且无降级区时返回 false', async (area) => {
    stubChrome({
      set: async () => {
        throw new Error('QUOTA_BYTES quota exceeded')
      },
    })
    await expect(storageSet(area, 'settings', { a: 1 })).resolves.toBe(false)
  })

  it('session 区底层抛错、当前环境也没有 window 时返回 false', async () => {
    stubChrome({
      set: async () => {
        throw new Error('session area gone')
      },
    })
    await expect(storageSet('session', 'draft', 'v')).resolves.toBe(false)
  })

  it('无 chrome 时 sync / local 区返回 false', async () => {
    await expect(storageSet('sync', 'settings', { a: 1 })).resolves.toBe(false)
    await expect(storageSet('local', 'settings', { a: 1 })).resolves.toBe(false)
  })
})

describe('storageRemove 的三区删除', () => {
  it.each(['sync', 'local', 'session'] as const)('%s 区删除成功返回 true', async (area) => {
    const remove = vi.fn(async () => {})
    stubChrome({ remove })
    await expect(storageRemove(area, 'settings')).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith('settings')
  })

  it.each(['sync', 'local'] as const)('%s 区底层抛错且无降级区时返回 false', async (area) => {
    stubChrome({
      remove: async () => {
        throw new Error('storage unavailable')
      },
    })
    await expect(storageRemove(area, 'settings')).resolves.toBe(false)
  })

  it('session 区底层抛错、当前环境也没有 window 时返回 false', async () => {
    stubChrome({
      remove: async () => {
        throw new Error('session area gone')
      },
    })
    await expect(storageRemove('session', 'draft')).resolves.toBe(false)
  })

  it('无 chrome 时 sync / local 区返回 false', async () => {
    await expect(storageRemove('sync', 'settings')).resolves.toBe(false)
    await expect(storageRemove('local', 'settings')).resolves.toBe(false)
  })
})
