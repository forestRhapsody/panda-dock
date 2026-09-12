// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import { useLocale } from './useLocale'

/**
 * 应用内文案是 i18next（§5 第 1 条），语言由 settings.locale 决定：
 * 'zh' / 'en' 直接命中，'system' 与缺失值按 navigator.language 解析（zh* → 中文，其余英文）。
 * 这里断言的是 i18n 实例的真实 language，而不是「changeLanguage 被调用过」。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let changeListeners: ChangeListener[]
let syncStore: Record<string, unknown>

/** 内存版 chrome 桩：与 useLocale 的 storageGet / onChanged 用法对齐 */
function stubChrome(options: { runtimeId?: string | null; settings?: unknown } = {}) {
  syncStore = options.settings === undefined ? {} : { settings: options.settings }
  changeListeners = []
  const area = {
    get: async (key: string) => (key in syncStore ? { [key]: syncStore[key] } : {}),
    set: async () => {},
    remove: async () => {},
  }
  globalWithChrome.chrome = {
    runtime: options.runtimeId === null ? {} : { id: options.runtimeId ?? 'test-extension-id' },
    storage: {
      sync: area,
      local: area,
      session: area,
      onChanged: {
        addListener: (listener: ChangeListener) => {
          changeListeners.push(listener)
        },
        removeListener: (listener: ChangeListener) => {
          changeListeners = changeListeners.filter((item) => item !== listener)
        },
      },
    },
  }
}

// 订阅 i18n 的 languageChanged，让 Probe 能真的渲染出当前语言
const subscribeLanguage = (onStoreChange: () => void) => {
  i18n.on('languageChanged', onStoreChange)
  return () => {
    i18n.off('languageChanged', onStoreChange)
  }
}
const getLanguage = () => i18n.language

function Probe() {
  useLocale()
  const language = useSyncExternalStore(subscribeLanguage, getLanguage)
  return <span data-testid='language'>{language}</span>
}

let container: HTMLDivElement
let root: Root

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const render = () => act(async () => root.render(<Probe />))
const language = () => container.textContent

const emitChange = (newValue: unknown, areaName = 'sync') => {
  act(() => {
    for (const listener of [...changeListeners]) listener({ settings: { newValue } }, areaName)
  })
}

beforeEach(async () => {
  changeListeners = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await i18n.changeLanguage('zh')
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
  vi.unstubAllGlobals()
  await i18n.changeLanguage('zh')
})

describe('useLocale 按设置或系统语言切换', () => {
  it("settings.locale='en' 时切到 en", async () => {
    stubChrome({ settings: { locale: 'en' } })

    await render()
    await flush()

    expect(language()).toBe('en')
  })

  it("settings.locale='zh' 时切到 zh（即使当前是 en）", async () => {
    stubChrome({ settings: { locale: 'zh' } })
    await i18n.changeLanguage('en')

    await render()
    await flush()

    expect(language()).toBe('zh')
  })

  it("settings.locale='system' 时按 navigator.language=zh-CN 解析为 zh", async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    stubChrome({ settings: { locale: 'system' } })
    await i18n.changeLanguage('en')

    await render()
    await flush()

    expect(language()).toBe('zh')
  })

  it('缺失 locale 时按 navigator.language=zh-CN 解析为 zh', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    stubChrome({ settings: {} })
    await i18n.changeLanguage('en')

    await render()
    await flush()

    expect(language()).toBe('zh')
  })

  it('缺失 locale 时按 navigator.language=en-US 解析为 en', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' })
    stubChrome({ settings: {} })

    await render()
    await flush()

    expect(language()).toBe('en')
  })

  it('navigator 没有 language 时回退 en', async () => {
    vi.stubGlobal('navigator', {})
    stubChrome({ settings: {} })

    await render()
    await flush()

    expect(language()).toBe('en')
  })

  it("非法 locale（如 'fr'）按 system 解析，而不是原样透传", async () => {
    vi.stubGlobal('navigator', { language: 'en-US' })
    stubChrome({ settings: { locale: 'fr' } })

    await render()
    await flush()

    expect(language()).toBe('en')
  })

  it('chrome 完全缺失时按 system 解析且不抛错', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    await i18n.changeLanguage('en')

    await render()
    await flush()

    expect(container.textContent).toBe('zh')
  })
})

describe('useLocale 的实时切换与清理', () => {
  it('onChanged 推送新 locale 即时切换（无需重挂载）', async () => {
    stubChrome({ settings: { locale: 'zh' } })

    await render()
    await flush()
    expect(language()).toBe('zh')

    emitChange({ locale: 'en' })
    expect(language()).toBe('en')

    emitChange({ locale: 'zh' })
    expect(language()).toBe('zh')
  })

  it('onChanged 推送 system 时按当前 navigator.language 重新解析', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' })
    stubChrome({ settings: { locale: 'zh' } })

    await render()
    await flush()
    expect(language()).toBe('zh')

    emitChange({ locale: 'system' })
    expect(language()).toBe('en')
  })

  it('onChanged 只响应 sync 区域且必须有 settings 变更', async () => {
    stubChrome({ settings: { locale: 'zh' } })

    await render()
    await flush()

    emitChange({ locale: 'en' }, 'local')
    expect(language()).toBe('zh')

    act(() => {
      for (const listener of [...changeListeners]) listener({}, 'sync')
    })
    expect(language()).toBe('zh')

    emitChange({ locale: 'en' })
    expect(language()).toBe('en')
  })

  it('卸载后移除 onChanged 监听', async () => {
    stubChrome({ settings: { locale: 'zh' } })

    await render()
    await flush()
    expect(changeListeners).toHaveLength(1)

    act(() => root.unmount())
    expect(changeListeners).toHaveLength(0)

    root = createRoot(container)
  })
})
