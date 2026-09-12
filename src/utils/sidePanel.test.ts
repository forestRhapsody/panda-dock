import { afterEach, describe, expect, it, vi } from 'vitest'

import { MSG_CLOSE_NATIVE_SIDE_PANEL } from '@/utils/messages'

import { closeNativeSidePanel, openNativeSidePanel } from './sidePanel'

/** 用 unknown 断开与 @types/chrome 的强类型绑定：这里只需要一个「可写可删」的桩 */
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

type OpenOptions = {
  getCurrent?: () => Promise<unknown>
  open?: (...args: unknown[]) => Promise<void>
  close?: (...args: unknown[]) => Promise<void>
  sendMessage?: (...args: unknown[]) => Promise<unknown>
}

/**
 * `'sidePanel' in chrome` 是这个模块的开关：Chrome 版本可能没有该命名空间。
 * 用对象字面量精确控制「缺 sidePanel」与「有 sidePanel 但缺方法」两种情况。
 */
function stubChrome(opts: OpenOptions = {}) {
  const chromeStub: Record<string, unknown> = {}
  if (opts.sendMessage) chromeStub.runtime = { sendMessage: opts.sendMessage }
  if (opts.getCurrent || opts.open || opts.close) {
    if (opts.getCurrent) chromeStub.windows = { getCurrent: opts.getCurrent }
    const sp: Record<string, unknown> = {}
    if (opts.open) sp.open = opts.open
    if (opts.close) sp.close = opts.close
    chromeStub.sidePanel = sp
  }
  globalWithChrome.chrome = chromeStub
  return chromeStub
}

afterEach(() => {
  delete globalWithChrome.chrome
  vi.restoreAllMocks()
})

/**
 * `chrome.sidePanel.open` 必须拿到当前窗口的 windowId 才能开在用户眼前；
 * 任何一步拿不到（没有 chrome / 没有 windows / 没有 sidePanel / 拿不到 win.id / open 抛错）
 * 都必须回 false，调用方据此回退到网页抽屉。
 */
describe('openNativeSidePanel', () => {
  it('成功时用当前窗口的 windowId 调 sidePanel.open，并返回 true', async () => {
    const open = vi.fn(async () => undefined)
    stubChrome({ getCurrent: vi.fn(async () => ({ id: 11 })), open })

    await expect(openNativeSidePanel()).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith({ windowId: 11 })
  })

  it('sidePanel.open 抛错时返回 false（需要用户手势，可能被拒绝）', async () => {
    stubChrome({
      getCurrent: vi.fn(async () => ({ id: 11 })),
      open: vi.fn(async () => {
        throw new Error('sidePanel.open() may only be called in response to a user gesture')
      }),
    })

    await expect(openNativeSidePanel()).resolves.toBe(false)
  })

  it('没有 chrome 时返回 false', async () => {
    await expect(openNativeSidePanel()).resolves.toBe(false)
  })

  it("chrome 存在但没有 sidePanel 命名空间（'sidePanel' in chrome 为假）时返回 false，且不调 open", async () => {
    const getCurrent = vi.fn(async () => ({ id: 11 }))
    globalWithChrome.chrome = { windows: { getCurrent } }

    await expect(openNativeSidePanel()).resolves.toBe(false)
    expect(getCurrent).not.toHaveBeenCalled()
  })

  it('没有 chrome.windows 时返回 false，不裸调 getCurrent', async () => {
    const open = vi.fn(async () => undefined)
    globalWithChrome.chrome = { sidePanel: { open } }

    await expect(openNativeSidePanel()).resolves.toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('windows.getCurrent 抛错时返回 false', async () => {
    stubChrome({
      getCurrent: vi.fn(async () => {
        throw new Error('No current window')
      }),
      open: vi.fn(async () => undefined),
    })

    await expect(openNativeSidePanel()).resolves.toBe(false)
  })

  it('win.id 为 null 或 undefined 时返回 false，且不调 open', async () => {
    const open = vi.fn(async () => undefined)

    stubChrome({ getCurrent: vi.fn(async () => ({ id: null })), open })
    await expect(openNativeSidePanel()).resolves.toBe(false)

    stubChrome({ getCurrent: vi.fn(async () => ({})), open })
    await expect(openNativeSidePanel()).resolves.toBe(false)

    expect(open).not.toHaveBeenCalled()
  })

  it('sidePanel 存在但没有 open 方法时返回 false', async () => {
    stubChrome({ getCurrent: vi.fn(async () => ({ id: 11 })) })

    await expect(openNativeSidePanel()).resolves.toBe(false)
  })
})

/**
 * 关闭侧边栏：Chrome 141+ 才有 sidePanel.close，更早的版本必须降级成广播消息，
 * 否则「抽屉与侧边栏互斥」在旧版浏览器上失效（侧边栏不会被关掉）。
 */
describe('closeNativeSidePanel', () => {
  it('Chrome 141+ 有 sidePanel.close 时用当前 windowId 调用并返回 true', async () => {
    const close = vi.fn(async () => undefined)
    stubChrome({ getCurrent: vi.fn(async () => ({ id: 21 })), close })

    await expect(closeNativeSidePanel()).resolves.toBe(true)
    expect(close).toHaveBeenCalledWith({ windowId: 21 })
  })

  it('sidePanel.close 抛错时降级为 sendMessage(MSG_CLOSE_NATIVE_SIDE_PANEL)，仍返回 true', async () => {
    const close = vi.fn(async () => {
      throw new Error('not supported')
    })
    const sendMessage = vi.fn(async () => undefined)
    stubChrome({ getCurrent: vi.fn(async () => ({ id: 21 })), close, sendMessage })

    await expect(closeNativeSidePanel()).resolves.toBe(true)
    expect(close).toHaveBeenCalledWith({ windowId: 21 })
    expect(sendMessage).toHaveBeenCalledWith({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
  })

  it('win.id 拿不到时跳过 close，直接走广播并返回 true', async () => {
    const close = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async () => undefined)
    stubChrome({ getCurrent: vi.fn(async () => ({ id: null })), close, sendMessage })

    await expect(closeNativeSidePanel()).resolves.toBe(true)
    expect(close).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
  })

  it('没有 close 但有 sendMessage 时走广播并返回 true（旧版 Chrome 降级路径）', async () => {
    const sendMessage = vi.fn(async () => undefined)
    stubChrome({ getCurrent: vi.fn(async () => ({ id: 21 })), sendMessage })

    await expect(closeNativeSidePanel()).resolves.toBe(true)
    expect(sendMessage).toHaveBeenCalledWith({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
  })

  it('既没有 close 也没有 sendMessage 时返回 false', async () => {
    stubChrome({ getCurrent: vi.fn(async () => ({ id: 21 })) })

    await expect(closeNativeSidePanel()).resolves.toBe(false)
  })

  it('没有 chrome 时返回 false，不抛错', async () => {
    await expect(closeNativeSidePanel()).resolves.toBe(false)
  })

  it('sendMessage 抛错时返回 false（background 不可达）', async () => {
    stubChrome({
      sendMessage: vi.fn(async () => {
        throw new Error('Could not establish connection')
      }),
    })

    await expect(closeNativeSidePanel()).resolves.toBe(false)
  })
})
