// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MSG_GET_PAGE_URL } from '@/utils/messages'

import { getCurrentPageUrl } from './pageUrl'

/**
 * `getCurrentPageUrl` 有两条完全不同的路径：
 * 1. 网页内（http/https）直接回 window.location.href —— 那里没有 chrome，也不该为取自己的地址发消息；
 * 2. 扩展页（原生侧边栏等）经 chrome.tabs 桥接到 content script。
 *
 * 之所以整个文件跑 happy-dom：模块第 12 行在 try 之外读 `window.location.protocol`，
 * node 环境（无 window）下会直接抛 ReferenceError（见交付报告中的源码疑点）。
 * location 用 defineProperty 换成极简桩，避免依赖 happy-dom 的默认地址。
 */
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

const realLocation = window.location

/** 把 window.location 换成只带 href / protocol 的桩（happy-dom 的 location 默认不可写） */
function stubLocation(location: { href: string; protocol: string }): void {
  Object.defineProperty(window, 'location', { value: location, configurable: true })
}

type TabsStub = {
  query?: (...args: unknown[]) => Promise<unknown>
  sendMessage?: (...args: unknown[]) => Promise<unknown>
}

function stubTabs(impl: TabsStub): TabsStub {
  globalWithChrome.chrome = { tabs: impl }
  return impl
}

/** 把 window.location 还原成 happy-dom 的真实实现（不能破坏后续用例与其它文件） */
afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true })
  delete globalWithChrome.chrome
  vi.restoreAllMocks()
})

describe('getCurrentPageUrl 在网页内的直接返回', () => {
  it('http 页面直接回 href，完全不碰 chrome（不依赖 content script）', async () => {
    stubLocation({ href: 'http://a.test/path?q=1', protocol: 'http:' })
    const query = vi.fn(async () => [{ id: 9 }])
    const sendMessage = vi.fn(async () => ({ ok: true, url: 'https://bridge.test/' }))
    stubTabs({ query, sendMessage })

    await expect(getCurrentPageUrl()).resolves.toBe('http://a.test/path?q=1')
    expect(query).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('https 页面同样直接回 href', async () => {
    stubLocation({ href: 'https://a.test/p', protocol: 'https:' })

    await expect(getCurrentPageUrl()).resolves.toBe('https://a.test/p')
  })
})

describe('getCurrentPageUrl 在扩展页面的接线路径', () => {
  it('tabs.query 与 content 都正常时返回 content 回的 url', async () => {
    stubLocation({ href: 'chrome-extension://abc/sidepanel.html', protocol: 'chrome-extension:' })
    stubTabs({
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage: vi.fn(async () => ({ ok: true, url: 'https://a.test/p' })),
    })

    await expect(getCurrentPageUrl()).resolves.toBe('https://a.test/p')
  })

  it('向命中的 tab 发送 MSG_GET_PAGE_URL，且只查活动窗口的当前标签页', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })
    const stub = stubTabs({
      query: vi.fn(async () => [{ id: 42 }]),
      sendMessage: vi.fn(async () => ({ ok: true, url: 'https://a.test/p' })),
    })

    await getCurrentPageUrl()

    expect(stub.query).toHaveBeenCalledWith({ active: true, currentWindow: true })
    expect(stub.sendMessage).toHaveBeenCalledWith(42, { action: MSG_GET_PAGE_URL })
  })

  it('content 回 { ok:false } 时返回 null（错误响应没有 url 可取）', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })
    stubTabs({
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => ({ ok: false })),
    })

    await expect(getCurrentPageUrl()).resolves.toBeNull()
  })

  it('content 回 { ok:true } 但缺 url 时返回 null（旧版 content 的兜底）', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })
    stubTabs({
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => ({ ok: true })),
    })

    await expect(getCurrentPageUrl()).resolves.toBeNull()
  })

  it('content 回 undefined 时返回 null（未注入 content script）', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })
    stubTabs({
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => undefined),
    })

    await expect(getCurrentPageUrl()).resolves.toBeNull()
  })

  it('content 回的 url 是空串时原样返回，不被 ?? 当成缺失值', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })
    stubTabs({
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => ({ ok: true, url: '' })),
    })

    await expect(getCurrentPageUrl()).resolves.toBe('')
  })

  it('tabs.query 没命中标签页时返回 null，且不再发消息', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })
    const stub = stubTabs({
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => ({ ok: true, url: 'https://a.test/p' })),
    })

    await expect(getCurrentPageUrl()).resolves.toBeNull()
    expect(stub.sendMessage).not.toHaveBeenCalled()
  })

  it('tab.id 为 null / undefined 时返回 null（特权页、未注入页拿不到 id）', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })
    const sendMessage = vi.fn(async () => ({ ok: true, url: 'https://a.test/p' }))

    stubTabs({ query: vi.fn(async () => [{ id: null }]), sendMessage })
    await expect(getCurrentPageUrl()).resolves.toBeNull()

    stubTabs({ query: vi.fn(async () => [{}]), sendMessage })
    await expect(getCurrentPageUrl()).resolves.toBeNull()

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('tabs.query 抛错时返回 null', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })
    stubTabs({
      query: vi.fn(async () => {
        throw new Error('No window with id')
      }),
    })

    await expect(getCurrentPageUrl()).resolves.toBeNull()
  })

  it('tabs.sendMessage 抛错时返回 null（content 未注入 / 页面已关闭）', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })
    stubTabs({
      query: vi.fn(async () => [{ id: 3 }]),
      sendMessage: vi.fn(async () => {
        throw new Error('Could not establish connection')
      }),
    })

    await expect(getCurrentPageUrl()).resolves.toBeNull()
  })

  it('没有 chrome 且非 http(s) 时返回 null，不抛错', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })

    await expect(getCurrentPageUrl()).resolves.toBeNull()
  })

  it('chrome.tabs 缺 query 或 sendMessage 时返回 null，不裸调', async () => {
    stubLocation({ href: 'about:blank', protocol: 'about:' })

    stubTabs({ sendMessage: vi.fn() })
    await expect(getCurrentPageUrl()).resolves.toBeNull()

    const sendMessage = vi.fn()
    stubTabs({ query: vi.fn(async () => [{ id: 5 }]) })
    await expect(getCurrentPageUrl()).resolves.toBeNull()
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

/**
 * 未覆盖并已记录的源码疑点：第 12 行的 `window.location.protocol` 在 try 之外，
 * 所以「没有 window」或「有 window 但没有 location」时不会走 catch 回 null，
 * 而是以 ReferenceError / TypeError 拒绝。测试环境无法在不破坏 happy-dom 全局的前提下
 * 精确复现该场景，故仅在此记录（详见交付报告）。
 */
