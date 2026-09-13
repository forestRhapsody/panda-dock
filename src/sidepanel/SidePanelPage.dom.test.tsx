// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { DEFAULT_TOOLS } from '@/tools/registry'
import { setDraftValue } from '@/utils/draft'
import { MSG_CLOSE_NATIVE_SIDE_PANEL } from '@/utils/messages'

import SidePanelPage from './SidePanelPage'

/**
 * 原生侧边栏宿主页：
 * - 关闭 ToolsApp 自带 header（Chrome 已提供 header），但工具箱本身照常渲染；
 * - 挂载时与 background 建立 `toolkit-sidepanel` Port 长连接，用于「抽屉 ↔ 侧边栏」互斥；
 * - 首帧上报当前 windowId；收到关闭指令 / Escape / Alt+Shift+D 时关闭自身；卸载要断连并移除监听。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
type RuntimeMessageListener = (msg: unknown) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

/* eslint-disable @typescript-eslint/no-explicit-any */
let chromeStub: any
let changeListeners: ChangeListener[]
let runtimeMessageListeners: RuntimeMessageListener[]
let port: {
  postMessage: ReturnType<typeof vi.fn>
  onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> }
  disconnect: ReturnType<typeof vi.fn>
}
let closeSpy: ReturnType<typeof vi.fn>
let stores: Record<'sync' | 'session' | 'local', Record<string, unknown>>

/** 内存版 chrome：Port 用 callback 风格的 windows.getCurrent，与 SidePanelPage 的调用方式一致 */
function stubChrome() {
  changeListeners = []
  runtimeMessageListeners = []
  stores = { sync: {}, session: {}, local: {} }
  port = {
    postMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    disconnect: vi.fn(),
  }
  const area = (name: 'sync' | 'session' | 'local') => ({
    get: async (key: string) =>
      key in stores[name] ? { [key]: stores[name][key] } : ({} as Record<string, unknown>),
    set: async (obj: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]))
      Object.assign(stores[name], obj)
      for (const listener of [...changeListeners]) listener(changes, name)
    },
    remove: async (key: string) => {
      delete stores[name][key]
    },
  })
  chromeStub = {
    runtime: {
      id: 'test-extension-id',
      connect: vi.fn(() => port),
      getManifest: () => ({ version: '9.9.9' }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: vi.fn(async () => true),
      onMessage: {
        addListener: (listener: RuntimeMessageListener) => runtimeMessageListeners.push(listener),
        removeListener: (listener: RuntimeMessageListener) => {
          runtimeMessageListeners = runtimeMessageListeners.filter((item) => item !== listener)
        },
      },
    },
    storage: {
      sync: area('sync'),
      session: area('session'),
      local: area('local'),
      onChanged: {
        addListener: (listener: ChangeListener) => changeListeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          changeListeners = changeListeners.filter((item) => item !== listener)
        },
      },
    },
    windows: { getCurrent: vi.fn((cb: (win: { id: number }) => void) => cb({ id: 42 })) },
  }
  globalWithChrome.chrome = chromeStub
}

let container: HTMLDivElement
let root: Root

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

async function render() {
  await act(async () => {
    root.render(<SidePanelPage />)
  })
  await flush()
}

function pressKey(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }))
  })
}

function portMessageListener(): (msg: unknown) => void {
  return port.onMessage.addListener.mock.calls[0]?.[0] as (msg: unknown) => void
}

beforeEach(async () => {
  stubChrome()
  closeSpy = vi.fn()
  vi.stubGlobal('close', closeSpy)
  // draft 的内存缓存是模块级常驻的：重置激活项，避免用例间相互影响
  await setDraftValue('activeToolTab', null)
  await i18n.changeLanguage('zh')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
  vi.unstubAllGlobals()
})

describe('SidePanelPage：渲染共享工具箱', () => {
  it('渲染 ToolsApp 且关闭自带 header，选项卡为默认可见工具，无裸 i18n key', async () => {
    await render()

    expect(container.querySelector('.sp')).not.toBeNull()
    expect(container.querySelector('.tw')).not.toBeNull()
    // Chrome 已提供 header，宿主必须关掉 ToolsApp 自己的 header
    expect(container.querySelector('.tw__header')).toBeNull()
    expect(container.querySelector('.tw-nav')).not.toBeNull()

    const tabIds = [...container.querySelectorAll('[role="tab"]')].map((el) =>
      el.getAttribute('data-tool'),
    )
    expect(tabIds).toEqual(
      DEFAULT_TOOLS.filter((tool) => tool.id !== 'jwt' && tool.id !== 'hash').map(
        (tool) => tool.id,
      ),
    )
    expect(container.textContent).not.toContain('tool.registry.')
  })

  it('侧边栏使用全局工作区草稿，不随特定 Tab 隔离', async () => {
    // 写入全局草稿
    await setDraftValue('activeToolTab', 'json', null)
    await render()

    expect(container.querySelector('.tw')).not.toBeNull()
    const activeTab = container.querySelector('[role="tab"][aria-selected="true"]')
    expect(activeTab?.getAttribute('data-tool')).toBe('json')
  })
})

describe('SidePanelPage：与 background 的 Port 协议', () => {
  it('挂载时以 name=toolkit-sidepanel 连接，并首帧上报 windowId', async () => {
    await render()

    expect(chromeStub.runtime.connect).toHaveBeenCalledWith({ name: 'toolkit-sidepanel' })
    expect(chromeStub.windows.getCurrent).toHaveBeenCalled()
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'SIDE_PANEL_INIT', windowId: 42 })
  })

  it('拿不到 windowId 时不上报首帧（避免 background 定位到错误窗口）', async () => {
    chromeStub.windows.getCurrent = vi.fn((cb: (win: { id?: number }) => void) => cb({}))
    await render()

    expect(port.postMessage).not.toHaveBeenCalled()
  })

  it('chrome.runtime.connect 抛错时不崩，runtime 消息关闭仍然生效', async () => {
    chromeStub.runtime.connect = vi.fn(() => {
      throw new Error('no receiving end')
    })
    await render()

    expect(container.querySelector('.sp')).not.toBeNull()
    expect(runtimeMessageListeners).toHaveLength(1)

    // connect 失败不影响 runtime.onMessage 通道：background 的关闭指令仍能关掉面板
    // （页面已不再自行处理 Escape，见下方「不自行处理全局键盘」用例）
    act(() => {
      runtimeMessageListeners[0]({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
    })
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('Port 推送关闭指令时关闭侧边栏窗口', async () => {
    await render()
    const listener = portMessageListener()

    act(() => listener({ action: MSG_CLOSE_NATIVE_SIDE_PANEL }))

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('Port 推送无关消息时不关闭', async () => {
    await render()
    const listener = portMessageListener()

    act(() => listener({ action: 'SOMETHING_ELSE' }))

    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('runtime.onMessage 的关闭指令同样生效', async () => {
    await render()
    expect(runtimeMessageListeners).toHaveLength(1)

    act(() => {
      for (const listener of [...runtimeMessageListeners]) {
        listener({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
      }
    })

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('卸载时断开 Port、移除 runtime 消息监听与键盘监听', async () => {
    await render()
    expect(runtimeMessageListeners).toHaveLength(1)

    act(() => root.unmount())
    expect(port.disconnect).toHaveBeenCalledTimes(1)
    expect(runtimeMessageListeners).toHaveLength(0)

    // 键盘监听已移除：卸载后再按 Escape 不应再触发关闭
    closeSpy.mockClear()
    pressKey({ key: 'Escape' })
    expect(closeSpy).not.toHaveBeenCalled()

    root = createRoot(container)
  })
})

describe('SidePanelPage：不自行处理全局键盘（回归）', () => {
  it('Escape / Alt+Shift+D 不再由页面关闭面板（避免误关内层弹窗与编辑态）', async () => {
    await render()

    pressKey({ key: 'Escape' })
    pressKey({ key: 'd', altKey: true, shiftKey: true })

    // 回归：`window.close()` 对浏览器自有的侧边栏窗口是空操作（人工实测按 Escape 关不掉），
    // 而这两个分支又会与内层 ConfirmDialog 的 Escape 抢事件。关闭职责已交给 Chrome 自带的 X 按钮、
    // background 的全局快捷键与抽屉互斥消息，页面不应再自行 close。
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('普通按键同样不触发关闭', async () => {
    await render()

    pressKey({ key: 'a' })
    pressKey({ key: 'D', shiftKey: true })

    expect(closeSpy).not.toHaveBeenCalled()
  })
})

describe('SidePanelPage：chrome 守卫（回归）', () => {
  it('全局 chrome 缺失时仍能挂载，不抛 ReferenceError', async () => {
    // 回归：`chrome.runtime?.onMessage?.addListener` 曾写在 typeof 守卫之外，
    // 无 chrome 环境下会直接 ReferenceError（AGENTS §4 第 4 条要求所有 chrome.* 落在守卫内）
    delete globalWithChrome.chrome

    await expect(render()).resolves.toBeUndefined()

    expect(container.querySelector('.sp')).not.toBeNull()
    expect(container.querySelector('.tw')).not.toBeNull()
    // 没有 chrome 时不该连上任何 Port
    expect(container.querySelector('.tw-nav')).not.toBeNull()
  })
})
