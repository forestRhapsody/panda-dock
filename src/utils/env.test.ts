import { afterEach, describe, expect, it } from 'vitest'

import { storageGet, storageRemove, storageSet } from './env'

/**
 * `storageSet` 的失败信号是 T133 的基础：`chrome.storage.sync` 有单条 8KB 与写入频率配额，
 * 失败时它只返回 false（不抛错），调用方必须据此提示用户，否则用户会以为设置已保存。
 */
/** 用 unknown 断开与 @types/chrome 的强类型绑定：这里只需要一个「可写可删」的桩 */
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

function stubChrome(impl: {
  get?: () => Promise<unknown>
  set?: () => Promise<void>
  remove?: () => Promise<void>
}) {
  const area = {
    get: impl.get ?? (async () => ({})),
    set: impl.set ?? (async () => {}),
    remove: impl.remove ?? (async () => {}),
  }
  globalWithChrome.chrome = { storage: { sync: area, local: area, session: area } }
}

afterEach(() => {
  delete globalWithChrome.chrome
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
