import { afterEach, describe, expect, it, vi } from 'vitest'

import { MSG_CLOSE_DRAWER, MSG_OPEN_DRAWER } from '@/utils/messages'

import { closeDrawerInActiveTab, openDrawerInActiveTab } from './drawer'

/** 用 unknown 断开与 @types/chrome 的强类型绑定：这里只需要一个「可写可删」的桩 */
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

type TabsStub = {
  query?: (...args: unknown[]) => Promise<unknown>
  sendMessage?: (...args: unknown[]) => Promise<unknown>
}

function stubTabs(impl: TabsStub): TabsStub {
  globalWithChrome.chrome = { tabs: impl }
  return impl
}

afterEach(() => {
  delete globalWithChrome.chrome
  vi.restoreAllMocks()
})

/**
 * 打开抽屉的返回值决定 Popup/侧边栏是否要回退到别处（打不开就得换入口），
 * 尤其是「content 没回响应」必须当成功——旧版 content 只回 undefined，
 * 若按失败处理会让抽屉明明打开了却提示打不开。
 */
describe('openDrawerInActiveTab', () => {
  it('content 回 { ok:true } 时返回 true', async () => {
    stubTabs({
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => ({ ok: true })),
    })

    await expect(openDrawerInActiveTab()).resolves.toBe(true)
  })

  it('content 明确回 { ok:false } 时返回 false', async () => {
    stubTabs({
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => ({ ok: false })),
    })

    await expect(openDrawerInActiveTab()).resolves.toBe(false)
  })

  it('content 回 undefined（旧版 content / 只 ack 不返回）时按成功处理，返回 true', async () => {
    stubTabs({
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => undefined),
    })

    await expect(openDrawerInActiveTab()).resolves.toBe(true)
  })

  it('content 回空对象（旧版只回 {}）时同样按成功处理', async () => {
    stubTabs({
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => ({})),
    })

    await expect(openDrawerInActiveTab()).resolves.toBe(true)
  })

  it('向命中的 tab 发送 MSG_OPEN_DRAWER，且只查活动窗口的当前标签页', async () => {
    const stub = stubTabs({
      query: vi.fn(async () => [{ id: 42 }]),
      sendMessage: vi.fn(async () => ({ ok: true })),
    })

    await openDrawerInActiveTab()

    expect(stub.query).toHaveBeenCalledWith({ active: true, currentWindow: true })
    expect(stub.sendMessage).toHaveBeenCalledWith(42, { action: MSG_OPEN_DRAWER })
  })

  it('tabs.query 没命中标签页时返回 false，且不发消息', async () => {
    const stub = stubTabs({
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => ({ ok: true })),
    })

    await expect(openDrawerInActiveTab()).resolves.toBe(false)
    expect(stub.sendMessage).not.toHaveBeenCalled()
  })

  it('tab.id 为 null / undefined 时返回 false（特权页、未注入页）', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }))

    stubTabs({ query: vi.fn(async () => [{ id: null }]), sendMessage })
    await expect(openDrawerInActiveTab()).resolves.toBe(false)

    stubTabs({ query: vi.fn(async () => [{}]), sendMessage })
    await expect(openDrawerInActiveTab()).resolves.toBe(false)

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('tabs.sendMessage 抛错时返回 false（未注入 content script）', async () => {
    stubTabs({
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => {
        throw new Error('Receiving end does not exist')
      }),
    })

    await expect(openDrawerInActiveTab()).resolves.toBe(false)
  })

  it('tabs.query 抛错时返回 false', async () => {
    stubTabs({
      query: vi.fn(async () => {
        throw new Error('boom')
      }),
    })

    await expect(openDrawerInActiveTab()).resolves.toBe(false)
  })

  it('没有 chrome / chrome.tabs 缺 API 时返回 false，不裸调', async () => {
    await expect(openDrawerInActiveTab()).resolves.toBe(false)

    stubTabs({ sendMessage: vi.fn() })
    await expect(openDrawerInActiveTab()).resolves.toBe(false)

    stubTabs({ query: vi.fn() })
    await expect(openDrawerInActiveTab()).resolves.toBe(false)
  })
})

/**
 * 关闭是对「打开原生侧边栏」的互斥动作，属于尽力而为：
 * 目标页不可达时要静默放过，绝不能把异常抛给调用方（否则侧边栏就打不开了）。
 */
describe('closeDrawerInActiveTab', () => {
  it('向命中的 tab 发送 MSG_CLOSE_DRAWER', async () => {
    const stub = stubTabs({
      query: vi.fn(async () => [{ id: 5 }]),
      sendMessage: vi.fn(async () => undefined),
    })

    await expect(closeDrawerInActiveTab()).resolves.toBeUndefined()
    expect(stub.query).toHaveBeenCalledWith({ active: true, currentWindow: true })
    expect(stub.sendMessage).toHaveBeenCalledWith(5, { action: MSG_CLOSE_DRAWER })
  })

  it('没有命中标签页时静默返回，且不发消息', async () => {
    const stub = stubTabs({
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => undefined),
    })

    await expect(closeDrawerInActiveTab()).resolves.toBeUndefined()
    expect(stub.sendMessage).not.toHaveBeenCalled()
  })

  it('tab.id 为 null 时静默返回，且不发消息', async () => {
    const stub = stubTabs({
      query: vi.fn(async () => [{ id: null }]),
      sendMessage: vi.fn(async () => undefined),
    })

    await expect(closeDrawerInActiveTab()).resolves.toBeUndefined()
    expect(stub.sendMessage).not.toHaveBeenCalled()
  })

  it('sendMessage 抛错时不向外抛（content 未注入属正常情况）', async () => {
    stubTabs({
      query: vi.fn(async () => [{ id: 5 }]),
      sendMessage: vi.fn(async () => {
        throw new Error('Receiving end does not exist')
      }),
    })

    await expect(closeDrawerInActiveTab()).resolves.toBeUndefined()
  })

  it('tabs.query 抛错时不向外抛', async () => {
    stubTabs({
      query: vi.fn(async () => {
        throw new Error('boom')
      }),
    })

    await expect(closeDrawerInActiveTab()).resolves.toBeUndefined()
  })

  it('没有 chrome / 缺 API 时静默返回，不裸调也不抛错', async () => {
    await expect(closeDrawerInActiveTab()).resolves.toBeUndefined()

    const sendMessage = vi.fn(async () => undefined)
    stubTabs({ sendMessage })
    await expect(closeDrawerInActiveTab()).resolves.toBeUndefined()
    expect(sendMessage).not.toHaveBeenCalled()

    stubTabs({ query: vi.fn(async () => [{ id: 5 }]) })
    await expect(closeDrawerInActiveTab()).resolves.toBeUndefined()
  })
})
