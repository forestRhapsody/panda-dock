// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://example.com/page"}
import { act, StrictMode } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { DEFAULT_TOOLS } from '@/tools/registry'
import { toast } from '@/ui/toast'
import Toaster from '@/ui/Toaster'
import type { Settings } from '@/utils/settings'
import { defaultSettings, saveSettings } from '@/utils/settings'

import QuickSettings from './QuickSettings'

/**
 * Popup 的快捷设置与 Options 共用 chrome.storage.sync 的 settings。
 * 这里重点验证它最容易写错的两件事（AGENTS §5）：
 * 1) 写入必须是「脏标记 + useEffect」：update() 只改 state、不写存储；写入次数与
 *    用户改动同阶（setState updater 被 StrictMode 重复调用也不会翻倍）。
 * 2) 外部（Options / 悬浮球）通过 onChanged 推送时要即时同步 UI，且不能回写形成回环。
 * 另外覆盖与 Options 相同字段的联动（悬浮球总开关 / 停靠 / 点击动作 / 主题 / 语言 / 本站开关）。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 只把 saveSettings 换成 spy（实现仍走真实 storageSet），用来证明写入发生在
// useEffect 里而不是 update() 的事件处理函数里。
vi.mock('@/utils/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/settings')>()
  return { ...actual, saveSettings: vi.fn(actual.saveSettings) }
})

// —— chrome.storage 内存桩 ——

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void

interface StorageCall {
  area: string
  value: Record<string, unknown>
}

interface ChromeStub {
  sync: Record<string, unknown>
  local: Record<string, unknown>
  listeners: ChangeListener[]
  calls: StorageCall[]
  failSyncSet: boolean
}

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let chromeState: ChromeStub

/** 内存版 chrome.storage：sync + local 两个区，写入派发 onChanged（对齐 draft.dom.test.tsx） */
function stubChrome(settings?: unknown): ChromeStub {
  const sync: Record<string, unknown> = {}
  if (settings !== undefined) sync.settings = settings
  const local: Record<string, unknown> = {}
  const listeners: ChangeListener[] = []
  const calls: StorageCall[] = []
  const state: ChromeStub = { sync, local, listeners, calls, failSyncSet: false }

  const makeArea = (bucket: Record<string, unknown>, area: string) => ({
    get: async (key: string) => (key in bucket ? { [key]: bucket[key] } : {}),
    set: async (obj: Record<string, unknown>) => {
      if (area === 'sync' && state.failSyncSet) throw new Error('QUOTA_BYTES quota exceeded')
      calls.push({ area, value: obj })
      Object.assign(bucket, obj)
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]))
      for (const listener of [...listeners]) listener(changes, area)
    },
    remove: async (key: string) => {
      delete bucket[key]
    },
  })

  globalWithChrome.chrome = {
    runtime: { id: 'test-extension-id' },
    storage: {
      sync: makeArea(sync, 'sync'),
      local: makeArea(local, 'local'),
      session: makeArea({}, 'session'),
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          const i = listeners.indexOf(listener)
          if (i >= 0) listeners.splice(i, 1)
        },
      },
    },
  }
  chromeState = state
  return state
}

// —— DOM 工具 ——

let container: HTMLDivElement
let root: Root
let live: boolean

const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))

/** QuickSettings 自身不挂 Toaster；一起渲染才能断言「失败提示真的出现在界面上」 */
function Harness() {
  return (
    <>
      <QuickSettings />
      <Toaster />
    </>
  )
}

async function mount(settings?: unknown) {
  stubChrome(settings)
  await act(async () => {
    root.render(<Harness />)
  })
  await settle()
  await settle()
}

function fire(el: Element, type: string) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
  })
}

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function rowByTitle(title: string): HTMLElement {
  const strong = [...container.querySelectorAll('strong')].find((n) => n.textContent === title)
  const el = strong?.closest('.pop__setting')
  if (!el) throw new Error(`未找到快捷项：${title}`)
  return el as HTMLElement
}

function rowSwitch(title: string): HTMLButtonElement {
  const el = rowByTitle(title).querySelector<HTMLButtonElement>('button[role="switch"]')
  if (!el) throw new Error(`未找到快捷项开关：${title}`)
  return el
}

function triggerByLabel(label: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`button.tk-select[aria-label="${label}"]`)
  if (!el) throw new Error(`未找到 TkSelect 触发器：${label}`)
  return el
}

function selectText(label: string): string {
  return triggerByLabel(label).querySelector('.tk-select__value')?.textContent ?? ''
}

function choose(label: string, optionLabel: string) {
  fire(triggerByLabel(label), 'click')
  const item = [...document.body.querySelectorAll<HTMLElement>('.tk-select-item')].find(
    (n) => n.querySelector('.tk-select-item__label')?.textContent === optionLabel,
  )
  if (!item) throw new Error(`未找到选项：${label} → ${optionLabel}`)
  fire(item, 'pointerdown')
}

// —— 存储断言工具 ——

const syncCalls = () => chromeState.calls.filter((c) => c.area === 'sync')

function writtenSettings(): Settings {
  const last = syncCalls().at(-1)
  if (!last) throw new Error('sync.set 未被调用')
  return last.value.settings as Settings
}

/** 关键约定：写入的是完整 Settings（update 内部走 normalizeSettings），不能只写局部字段 */
function expectFullSettings(s: Settings) {
  expect(Object.keys(s).sort()).toEqual(Object.keys(defaultSettings()).sort())
}

/** 模拟外部（Options / 悬浮球）通过 storage.onChanged 推送新设置 */
function emitSync(newSettings: unknown, area = 'sync', key = 'settings') {
  act(() => {
    for (const listener of [...chromeState.listeners]) {
      listener({ [key]: { newValue: newSettings } }, area)
    }
  })
}

const BASE = (): Settings => ({ ...defaultSettings(), locale: 'zh' })

const siteHostname = () => window.location.hostname

beforeEach(async () => {
  toast.dismiss()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  live = true
  await i18n.changeLanguage('zh')
})

afterEach(async () => {
  if (live) {
    await act(async () => {
      root.unmount()
    })
  }
  container.remove()
  document.body.innerHTML = ''
  delete globalWithChrome.chrome
  toast.dismiss()
  vi.restoreAllMocks()
  vi.useRealTimers()
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

describe('QuickSettings 首屏读取与归一化', () => {
  it('读取 sync.settings：快捷项与本站规则按存储渲染，挂载阶段不写存储', async () => {
    await mount({
      ...BASE(),
      theme: 'dark',
      ballAction: 'native',
      ballDockMode: 'bottomRight',
      ballBottomRightRight: 200,
      ballBottomRightBottom: 20,
      ballBlacklist: [],
    })

    expect(container.querySelector('.pop__settings-head')?.textContent).toBe(
      i18n.t('popup.quickSettings'),
    )
    expect(rowSwitch(i18n.t('settings.quickOpen')).getAttribute('aria-checked')).toBe('true')
    expect(selectText('停靠行为')).toBe('固定右下角')
    expect(selectText('主题')).toBe('深色')
    expect(selectText('默认唤起方式')).toBe('浏览器原生侧边栏')

    const offsets = [...container.querySelectorAll<HTMLInputElement>('.pop__offset-input')]
    expect(offsets.map((i) => i.value)).toEqual(['200', '20'])

    // 本站行：黑名单为空 → 允许显示，并标注当前处于黑名单模式
    const site = rowByTitle(siteHostname())
    expect(site.textContent).toContain(i18n.t('popup.siteBallShown'))
    expect(site.textContent).toContain(i18n.t('settings.domainModeBlacklist').split('（')[0])
    expect(rowSwitch(siteHostname()).getAttribute('aria-checked')).toBe('true')

    expect(syncCalls()).toHaveLength(0)
  })

  it('非法 / 残缺数据回退默认，不崩也不写回', async () => {
    await mount({
      theme: 'neon',
      locale: 'fr',
      ballAction: 'bogus',
      ballDockMode: 'weird',
      ballSnap: false,
      ballBlacklist: 'not-an-array',
      ballDomainMode: 'nope',
    })

    expect(selectText('主题')).toBe('跟随系统')
    expect(selectText('语言')).toBe('跟随系统')
    expect(selectText('默认唤起方式')).toBe('网页内抽屉')
    // ballSnap=false 的旧数据迁移为「自由停靠」
    expect(selectText('停靠行为')).toBe('自由停靠')
    expect(container.querySelectorAll('.pop__offset-input')).toHaveLength(0)
    // 非数组名单归一化为空 → 仍允许显示
    expect(rowByTitle(siteHostname()).textContent).toContain(i18n.t('popup.siteBallShown'))
    expect(syncCalls()).toHaveLength(0)
  })

  it('关闭悬浮球总开关时不渲染本站规则行', async () => {
    await mount({ ...BASE(), quickOpen: false })

    expect(rowSwitch(i18n.t('settings.quickOpen')).getAttribute('aria-checked')).toBe('false')
    expect(container.querySelectorAll('strong').length).toBeGreaterThan(0)
    expect(
      [...container.querySelectorAll('strong')].some((n) => n.textContent === siteHostname()),
    ).toBe(false)
  })
})

describe('QuickSettings 脏标记 + useEffect 写存储', () => {
  it('单个快捷项改动：只写一次，且写入完整 Settings（其余字段不丢）', async () => {
    const stored: Settings = {
      ...BASE(),
      toolOrder: ['hash', 'json'],
      ballWhitelist: ['keep.example'],
    }
    await mount(stored)

    fire(rowSwitch(i18n.t('settings.quickOpen')), 'click')

    expect(syncCalls()).toHaveLength(1)
    const written = writtenSettings()
    expect(written.quickOpen).toBe(false)
    expect(written.ballWhitelist).toEqual(['keep.example'])
    // toolOrder 会被 normalizeToolLayout 补齐为全量顺序，用户自定义的前两位顺序保持
    expect(written.toolOrder.slice(0, 2)).toEqual(['hash', 'json'])
    expect(written.toolOrder).toHaveLength(DEFAULT_TOOLS.length)
    expectFullSettings(written)
  })

  it('多次修改不会重复落盘：两次编辑至多两次写入，最终写入含全部修改', async () => {
    await mount({ ...BASE(), ballDockMode: 'bottomRight' })
    const spy = vi.mocked(saveSettings)
    spy.mockClear()
    chromeState.calls.length = 0

    const offsets = [...container.querySelectorAll<HTMLInputElement>('.pop__offset-input')]
    await act(async () => {
      // 两个输入各触发一次 update({...})（React 19 的 act 会在每个离散事件后冲刷 effect）
      setNativeValue(offsets[0], '150')
      setNativeValue(offsets[1], '40')
    })

    // §5：update() 只置脏改 state，写入由 useEffect 落盘。
    // 这里两次编辑最多两次写入；若 update 里也写存储，就会翻倍成 4 次。
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2)
    expect(syncCalls().length).toBeLessThanOrEqual(2)
    const written = writtenSettings()
    expect(written.ballBottomRightRight).toBe(150)
    expect(written.ballBottomRightBottom).toBe(40)
    expectFullSettings(written)
  })

  it('StrictMode 下 updater 被重复调用也只写一次（写入不在 setState updater 里）', async () => {
    stubChrome(BASE())
    await act(async () => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      )
    })
    await settle()
    const spy = vi.mocked(saveSettings)
    spy.mockClear()
    chromeState.calls.length = 0

    fire(rowSwitch(i18n.t('settings.quickOpen')), 'click')

    // StrictMode 会把 setSettings 的 updater 调用两次（§5 的原始理由）；
    // 写入放在 effect 里所以只落一次盘，updater 保持纯函数。
    expect(spy).toHaveBeenCalledTimes(1)
    expect(syncCalls()).toHaveLength(1)
    expect(writtenSettings().quickOpen).toBe(false)
  })

  it('写入失败时弹出 saveFailed 提示，不静默', async () => {
    await mount(BASE())
    chromeState.failSyncSet = true

    fire(rowSwitch(i18n.t('settings.quickOpen')), 'click')
    await settle()

    expect(container.querySelector('.tk-toast__title')?.textContent).toBe(
      i18n.t('settings.saveFailed'),
    )
  })

  it('外部 onChanged 推送时 UI 即时同步，且不回写存储（无回环）', async () => {
    await mount(BASE())

    emitSync({ ...BASE(), quickOpen: false, theme: 'dark', ballDockMode: 'free' })

    expect(rowSwitch(i18n.t('settings.quickOpen')).getAttribute('aria-checked')).toBe('false')
    expect(selectText('主题')).toBe('深色')
    expect(selectText('停靠行为')).toBe('自由停靠')
    // 外部同步不算用户修改，绝不能写回
    expect(syncCalls()).toHaveLength(0)
  })

  it('onChanged 只响应 sync 区的 settings 变更', async () => {
    await mount(BASE())

    emitSync({ ...BASE(), quickOpen: false }, 'local')
    expect(rowSwitch(i18n.t('settings.quickOpen')).getAttribute('aria-checked')).toBe('true')

    act(() => {
      for (const listener of [...chromeState.listeners])
        listener({ other: { newValue: 1 } }, 'sync')
    })
    expect(rowSwitch(i18n.t('settings.quickOpen')).getAttribute('aria-checked')).toBe('true')

    emitSync({ ...BASE(), quickOpen: false })
    expect(rowSwitch(i18n.t('settings.quickOpen')).getAttribute('aria-checked')).toBe('false')
    expect(syncCalls()).toHaveLength(0)
  })

  it('卸载后移除 onChanged 监听', async () => {
    await mount(BASE())
    expect(chromeState.listeners).toHaveLength(1)

    await act(async () => {
      root.unmount()
    })
    live = false

    expect(chromeState.listeners).toHaveLength(0)
  })
})

describe('QuickSettings 本站悬浮球开关（域名规则联动）', () => {
  it('黑名单模式：默认允许 → 点击加入本站 → 隐藏 → 再点移除恢复', async () => {
    await mount({ ...BASE(), ballDomainMode: 'blacklist', ballBlacklist: [] })

    fire(rowSwitch(siteHostname()), 'click')
    expect(syncCalls()).toHaveLength(1)
    expect(writtenSettings().ballBlacklist).toEqual([siteHostname()])

    // 写入经 onChanged 回灌后，本站状态翻转为隐藏
    const site = rowByTitle(siteHostname())
    expect(site.textContent).toContain(i18n.t('popup.siteBallHidden'))
    expect(rowSwitch(siteHostname()).getAttribute('aria-checked')).toBe('false')

    fire(rowSwitch(siteHostname()), 'click')
    expect(writtenSettings().ballBlacklist).toEqual([])
    expect(rowByTitle(siteHostname()).textContent).toContain(i18n.t('popup.siteBallShown'))
  })

  it('黑名单里的通配符命中本站时显示为隐藏，点击可移除该规则', async () => {
    await mount({ ...BASE(), ballDomainMode: 'blacklist', ballBlacklist: ['*.example.com'] })

    expect(rowByTitle(siteHostname()).textContent).toContain(i18n.t('popup.siteBallHidden'))

    fire(rowSwitch(siteHostname()), 'click')
    expect(writtenSettings().ballBlacklist).toEqual([])
    expect(rowByTitle(siteHostname()).textContent).toContain(i18n.t('popup.siteBallShown'))
  })

  it('白名单模式：默认隐藏，点击把本站加入白名单后允许显示', async () => {
    await mount({ ...BASE(), ballDomainMode: 'whitelist', ballWhitelist: [] })

    const site = rowByTitle(siteHostname())
    expect(site.textContent).toContain(i18n.t('popup.siteBallHidden'))
    expect(site.textContent).toContain(i18n.t('settings.domainModeWhitelist').split('（')[0])
    expect(rowSwitch(siteHostname()).getAttribute('aria-checked')).toBe('false')

    fire(rowSwitch(siteHostname()), 'click')
    expect(writtenSettings().ballWhitelist).toEqual([siteHostname()])
    expect(rowByTitle(siteHostname()).textContent).toContain(i18n.t('popup.siteBallShown'))
  })
})

describe('QuickSettings 其余快捷项', () => {
  it('停靠模式：切换时同步 ballSnap，固定右下角后可编辑边距', async () => {
    await mount(BASE())

    choose('停靠行为', '自由停靠')
    expect(writtenSettings()).toEqual({ ...BASE(), ballDockMode: 'free', ballSnap: false })
    expectFullSettings(writtenSettings())
    expect(container.querySelectorAll('.pop__offset-input')).toHaveLength(0)

    choose('停靠行为', '固定右下角')
    expect(writtenSettings()).toEqual({ ...BASE(), ballDockMode: 'bottomRight', ballSnap: false })

    const offsets = [...container.querySelectorAll<HTMLInputElement>('.pop__offset-input')]
    expect(offsets).toHaveLength(2)
    act(() => {
      setNativeValue(offsets[0], '120')
    })
    expect(writtenSettings().ballBottomRightRight).toBe(120)
    expectFullSettings(writtenSettings())
  })

  it('点击动作 / 主题 / 语言：逐项写入完整对象', async () => {
    await mount(BASE())
    expect(container.textContent).toContain('数据仅限当前标签页使用')
    expect(container.textContent).toContain('所有标签页共用一份数据')
    expect(container.textContent).toContain('数据保留至浏览器关闭')
    expect(container.textContent).toContain('与网页抽屉数据相互独立')

    choose('默认唤起方式', '浏览器原生侧边栏')
    expect(writtenSettings()).toEqual({ ...BASE(), ballAction: 'native' })

    choose('主题', '深色')
    expect(writtenSettings()).toEqual({ ...BASE(), ballAction: 'native', theme: 'dark' })

    choose('语言', 'English')
    expect(writtenSettings()).toEqual({
      ...BASE(),
      ballAction: 'native',
      theme: 'dark',
      locale: 'en',
    })
    // QuickSettings 自身不切语言（由 Popup 顶层的 useLocale 负责），只负责持久化
    expect(i18n.language).toBe('zh')
    expectFullSettings(writtenSettings())
  })
})

describe('QuickSettings 文案', () => {
  it('切到 en 渲染英文文案，切回 zh 渲染中文，且不出现裸 i18n key', async () => {
    await mount(BASE())
    expect(container.querySelector('.pop__settings-head')?.textContent).toBe('快捷设置')

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(container.querySelector('.pop__settings-head')?.textContent).toBe('Quick settings')
    expect(container.textContent).not.toContain('快捷设置')

    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    expect(container.querySelector('.pop__settings-head')?.textContent).toBe('快捷设置')

    const text = container.textContent ?? ''
    expect(text).not.toMatch(/settings\.[a-zA-Z]/)
    expect(text).not.toMatch(/popup\.[a-zA-Z]/)
    expect(text).not.toMatch(/common\.[a-zA-Z]/)
  })
})
