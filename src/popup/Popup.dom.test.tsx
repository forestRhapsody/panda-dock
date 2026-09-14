// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { MSG_CLOSE_DRAWER, MSG_CLOSE_NATIVE_SIDE_PANEL, MSG_OPEN_DRAWER } from '@/utils/messages'
import { formatShortcutForDisplay } from '@/utils/shortcuts'

import Popup from './Popup'

/**
 * Popup 是扩展的默认落地页：设置入口 + 「打开侧边栏 / 网页抽屉」两个互斥动作 + 快捷设置。
 * 这里断言真实可观察的跨端调用：经 env 打开 options.html、经 content 消息关抽屉、
 * 经 sidePanel / background 打开与关闭，以及失败时的降级提示（AGENTS §4 第 8 条互斥语义）。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

/* eslint-disable @typescript-eslint/no-explicit-any */
let chromeStub: any
let listeners: ChangeListener[]
let syncStore: Record<string, unknown>
let closeSpy: ReturnType<typeof vi.fn>

/** 内存版 chrome：覆盖 Popup 与 QuickSettings 真正用到的 API，写操作全部可断言 */
function stubChrome() {
  listeners = []
  syncStore = {}
  const area = (name: string) => ({
    get: async (key: string) =>
      name === 'sync' && key in syncStore ? { [key]: syncStore[key] } : {},
    set: async (obj: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]))
      if (name === 'sync') Object.assign(syncStore, obj)
      for (const listener of [...listeners]) listener(changes, name)
    },
    remove: async () => {},
  })
  chromeStub = {
    runtime: {
      id: 'test-extension-id',
      getManifest: () => ({ version: '9.9.9' }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: vi.fn(async () => true),
    },
    storage: {
      sync: area('sync'),
      session: area('session'),
      local: area('local'),
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          listeners = listeners.filter((item) => item !== listener)
        },
      },
    },
    tabs: {
      create: vi.fn(async () => ({ id: 1 })),
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
    windows: { getCurrent: vi.fn(async () => ({ id: 42 })) },
    sidePanel: { open: vi.fn(async () => {}) },
    commands: { getAll: vi.fn(async () => []) },
  }
  globalWithChrome.chrome = chromeStub
}

let container: HTMLDivElement
let root: Root

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

async function render() {
  await act(async () => {
    root.render(<Popup />)
  })
  await flush()
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((el) =>
    el.textContent?.includes(text),
  )
  if (!button) throw new Error(`未找到按钮：${text}`)
  return button
}

beforeEach(async () => {
  stubChrome()
  closeSpy = vi.fn()
  vi.stubGlobal('close', closeSpy)
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

describe('Popup：基础渲染与设置入口', () => {
  it('渲染头部、快捷设置与两个工具箱打开按钮，界面不出现裸 i18n key', async () => {
    await render()

    expect(container.querySelector('.pop')).not.toBeNull()
    expect(container.textContent).toContain('Panda Dock')
    expect(container.textContent).toContain(i18n.t('popup.quickSettings'))
    expect(container.textContent).toContain(i18n.t('popup.openSidePanel'))
    expect(container.textContent).toContain(i18n.t('popup.openDrawer'))
    // 文案若漏登记 key，界面上会直接显示 key 本身
    expect(container.textContent).not.toMatch(/popup\.[A-Za-z]/)
    expect(container.textContent).not.toMatch(/settings\.[A-Za-z]/)
  })

  it('把 chrome 配置的快捷键显示在快捷键按钮里', async () => {
    chromeStub.commands.getAll = vi.fn(async () => [
      { name: 'toggle-dock', shortcut: 'Ctrl+Alt+K' },
    ])
    await render()

    const kbd = container.querySelector('.pop__kbd')
    expect(kbd?.textContent).toBe(formatShortcutForDisplay('Ctrl+Alt+K'))
  })

  it('当快捷键未绑定（空串）时，快捷键按钮展示为「未设置」', async () => {
    chromeStub.commands.getAll = vi.fn(async () => [{ name: 'toggle-dock', shortcut: '' }])
    await render()

    const kbd = container.querySelector('.pop__kbd')
    expect(kbd?.textContent).toBe(i18n.t('settings.shortcutNotSet'))
  })

  it('点击设置按钮经 chrome.tabs.create 打开 options.html', async () => {
    await render()

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t('popup.openOptions')}"]`)
        ?.click()
    })
    await flush()

    expect(chromeStub.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/options.html',
    })
  })

  it('非扩展环境（无 chrome）降级为预览：不渲染侧边栏动作区，也不抛错', async () => {
    delete globalWithChrome.chrome
    await render()

    expect(container.querySelector('.pop')).not.toBeNull()
    expect(container.querySelector('.pop__native')).toBeNull()
    expect(container.textContent).toContain(i18n.t('popup.quickSettings'))
  })
})

describe('Popup：打开原生侧边栏（互斥 + 降级）', () => {
  it('先经 content 关掉网页抽屉，再带 windowId 打开侧边栏，成功后关闭 popup', async () => {
    await render()

    await act(async () => {
      buttonByText(i18n.t('popup.openSidePanel')).click()
    })
    await flush()

    expect(chromeStub.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true })
    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(7, { action: MSG_CLOSE_DRAWER })
    expect(chromeStub.sidePanel.open).toHaveBeenCalledWith({ windowId: 42 })
    expect(closeSpy).toHaveBeenCalled()
    expect(container.textContent).not.toContain(i18n.t('popup.sidePanelFail'))
  })

  it('侧边栏不可用时展示失败提示，且不关闭 popup', async () => {
    delete chromeStub.sidePanel
    await render()

    await act(async () => {
      buttonByText(i18n.t('popup.openSidePanel')).click()
    })
    await flush()

    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(7, { action: MSG_CLOSE_DRAWER })
    expect(container.textContent).toContain(i18n.t('popup.sidePanelFail'))
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('chrome.sidePanel.open 抛错时同样降级为失败提示', async () => {
    chromeStub.sidePanel.open = vi.fn(async () => {
      throw new Error('gesture required')
    })
    await render()

    await act(async () => {
      buttonByText(i18n.t('popup.openSidePanel')).click()
    })
    await flush()

    expect(container.textContent).toContain(i18n.t('popup.sidePanelFail'))
    expect(closeSpy).not.toHaveBeenCalled()
  })
})

describe('Popup：打开网页内抽屉（互斥 + 降级）', () => {
  it('先经 background 广播关闭原生侧边栏，再经 content 打开抽屉，成功后关闭 popup', async () => {
    await render()

    await act(async () => {
      buttonByText(i18n.t('popup.openDrawer')).click()
    })
    await flush()

    // sidePanel.close 不可用 → 走 background 广播这条降级路径
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({
      action: MSG_CLOSE_NATIVE_SIDE_PANEL,
    })
    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(7, { action: MSG_OPEN_DRAWER })
    expect(closeSpy).toHaveBeenCalled()
    expect(container.textContent).not.toContain(i18n.t('popup.drawerFail'))
  })

  it('sidePanel.close 可用时优先本地关闭，不再打扰 background', async () => {
    chromeStub.sidePanel.close = vi.fn(async () => {})
    await render()

    await act(async () => {
      buttonByText(i18n.t('popup.openDrawer')).click()
    })
    await flush()

    expect(chromeStub.sidePanel.close).toHaveBeenCalledWith({ windowId: 42 })
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled()
    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(7, { action: MSG_OPEN_DRAWER })
  })

  it('目标页不支持抽屉时展示降级提示，且不关闭 popup', async () => {
    chromeStub.tabs.sendMessage = vi.fn(async () => ({ ok: false }))
    await render()

    await act(async () => {
      buttonByText(i18n.t('popup.openDrawer')).click()
    })
    await flush()

    expect(container.textContent).toContain(i18n.t('popup.drawerFail'))
    expect(closeSpy).not.toHaveBeenCalled()
  })
})
