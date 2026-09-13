// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { DEFAULT_TOOLS, defaultToolLayout } from '@/tools/registry'
import { toast } from '@/ui/toast'
import { applyBackup, exportSettingsBackup, parseAndValidateBackup } from '@/utils/backup'
import type { Settings } from '@/utils/settings'
import { BALL_IMAGE_MAX_BYTES, defaultSettings } from '@/utils/settings'

import OptionsPage from './OptionsPage'

/**
 * OptionsPage 是设置的唯一完整编辑入口（AGENTS §6.3）。这里按真实可观察行为断言：
 * 1) 首屏读取一律过 normalizeSettings：旧数据 / 残缺数据不崩、非法值回退默认；
 * 2) 每次改动都用 saveSettings 提交**完整** Settings（不能只写局部字段导致丢字段）；
 * 3) 写入失败必须提示用户（chrome.storage.sync 是静默失败，§4 第 7 条）；
 * 4) 破坏性操作走 ConfirmDialog，绝不用 window.confirm（§4 第 14 条、§8）；
 * 5) 自定义悬浮球图片走 chrome.storage.local（§5 settings 8KB 配额）。
 * 不 mock React 组件，只 mock 会触发真实下载 / 真实校验的备份模块。
 */

// 备份模块会真的创建 Blob 与下载锚点；本文件只验证「OptionsPage 是否正确调用
// 备份 API、以及按返回结果显示提示」，真实备份逻辑由 backup.dom.test.ts 覆盖。
vi.mock('@/utils/backup', () => ({
  exportSettingsBackup: vi.fn(),
  parseAndValidateBackup: vi.fn(),
  applyBackup: vi.fn(),
}))

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  /** 模拟 sync 配额写满：set 抛错 → storageSet 返回 false */
  failSyncSet: boolean
  /** 模拟 local 写入失败 */
  failLocalSet: boolean
}

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let chromeState: ChromeStub

/** 内存版 chrome.storage：给 sync + local 两个区，写入派发 onChanged（对齐 draft.dom.test.tsx） */
function stubChrome(initial: { settings?: unknown; ballImage?: string | null } = {}): ChromeStub {
  const sync: Record<string, unknown> = {}
  if ('settings' in initial) sync.settings = initial.settings
  const local: Record<string, unknown> = {}
  if ('ballImage' in initial) local.ballImage = initial.ballImage
  const listeners: ChangeListener[] = []
  const calls: StorageCall[] = []
  const state: ChromeStub = {
    sync,
    local,
    listeners,
    calls,
    failSyncSet: false,
    failLocalSet: false,
  }

  const makeArea = (bucket: Record<string, unknown>, area: string) => ({
    get: async (key: string) => (key in bucket ? { [key]: bucket[key] } : {}),
    set: async (obj: Record<string, unknown>) => {
      if (area === 'sync' && state.failSyncSet) throw new Error('QUOTA_BYTES quota exceeded')
      if (area === 'local' && state.failLocalSet) throw new Error('local write failed')
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

const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))

/**
 * 条件轮询等待：`settle(ms)` 是固定 sleep，而 `pickFile` 之后的
 * FileReader → chrome.storage → setState 异步链在负载下可能超过 10ms（实测偶发红）。
 * 这里改成「断言成立即返回」，超时后抛出最后一次断言错误，报错信息与直接断言一致。
 */
async function waitFor(assert: () => void, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      assert()
      return
    } catch (err) {
      if (Date.now() >= deadline) throw err
      await settle(1)
    }
  }
}

/** 挂载 OptionsPage 并等待首屏的异步读取（设置 / 图片 / 快捷键）落定 */
async function mount(stored?: unknown) {
  stubChrome(stored === undefined ? {} : { settings: stored })
  await act(async () => {
    root.render(<OptionsPage />)
  })
  await settle()
  await settle()
}

function fire(el: Element, type: string) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
  })
}

/** React 受控 textarea/input 需要走原生 setter 才能让 onChange 收到新值 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function triggerByLabel(label: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`button.tk-select[aria-label="${label}"]`)
  if (!el) throw new Error(`未找到 TkSelect 触发器：${label}`)
  return el
}

/** TkSelect 当前显示的 label（.tk-select__value） */
function selectText(label: string): string {
  return triggerByLabel(label).querySelector('.tk-select__value')?.textContent ?? ''
}

/** 展开下拉并点选指定文案的选项（面板经 portal 渲染到 document.body） */
function choose(label: string, optionLabel: string) {
  fire(triggerByLabel(label), 'click')
  const item = [...document.body.querySelectorAll<HTMLElement>('.tk-select-item')].find(
    (n) => n.querySelector('.tk-select-item__label')?.textContent === optionLabel,
  )
  if (!item) throw new Error(`未找到选项：${label} → ${optionLabel}`)
  fire(item, 'pointerdown')
}

/** 按卡片标题定位卡片，避免页面上多个同名按钮串味 */
function card(title: string): HTMLElement {
  const h2 = [...container.querySelectorAll('h2')].find((n) => n.textContent === title)
  const el = h2?.closest('.opt__card')
  if (!el) throw new Error(`未找到卡片：${title}`)
  return el as HTMLElement
}

/** 卡片标题栏里的「恢复默认」按钮 */
function resetButtonOf(title: string): HTMLButtonElement {
  const el = card(title).querySelector<HTMLButtonElement>('button.opt__reset')
  if (!el) throw new Error(`未找到恢复默认按钮：${title}`)
  return el
}

/** 悬浮球总开关（TOGGLE_FIELDS 里的 switch 没有 aria-label，只能按卡片定位） */
function ballToggle(): HTMLButtonElement {
  const el = card('悬浮球与唤起方式').querySelector<HTMLButtonElement>('button[role="switch"]')
  if (!el) throw new Error('未找到悬浮球总开关')
  return el
}

function toolRows(): { name: string; on: boolean }[] {
  return [...container.querySelectorAll<HTMLLIElement>('.opt-tools__row')].map((row) => ({
    name: row.querySelector('.opt-tools__name')?.textContent ?? '',
    on: row.querySelector('button[role="switch"]')?.getAttribute('aria-checked') === 'true',
  }))
}

function toolSwitch(label: string): HTMLButtonElement {
  const el = [...container.querySelectorAll<HTMLButtonElement>('.opt-tools__row button')].find(
    (b) => b.getAttribute('aria-label') === label,
  )
  if (!el) throw new Error(`未找到工具开关：${label}`)
  return el
}

function textarea(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('textarea')
  if (!el) throw new Error('未找到域名输入框')
  return el
}

const domainTab = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement

const imageInput = () =>
  container.querySelector<HTMLInputElement>('input[accept="image/*"]') as HTMLInputElement
const importInput = () =>
  container.querySelector<HTMLInputElement>(
    'input[accept=".json,application/json"]',
  ) as HTMLInputElement

function pickFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

// —— 存储断言工具 ——

const syncCalls = () => chromeState.calls.filter((c) => c.area === 'sync')

function writtenSettings(): Settings {
  const last = syncCalls().at(-1)
  if (!last) throw new Error('sync.set 未被调用')
  return last.value.settings as Settings
}

/** 关键约定：写入的必须是完整 Settings，而不是只改了某个局部字段 */
function expectFullSettings(s: Settings) {
  expect(Object.keys(s).sort()).toEqual(Object.keys(defaultSettings()).sort())
}

const BASE = (): Settings => ({ ...defaultSettings(), locale: 'zh' })

function expectNoRawKeys() {
  const text = container.textContent ?? ''
  expect(text).not.toMatch(/settings\.[a-zA-Z]/)
  expect(text).not.toMatch(/tool\.registry\./)
  expect(text).not.toMatch(/common\.[a-zA-Z]/)
}

beforeEach(() => {
  // toast.ts 是模块级单例，清空避免上一条用例的提示串进来
  toast.dismiss()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // 语言解析默认走 navigator.language（'system'）；固定为中文让「回退默认」用例可预期
  vi.stubGlobal('navigator', { language: 'zh-CN' })
  vi.mocked(exportSettingsBackup).mockReset().mockResolvedValue(undefined)
  vi.mocked(parseAndValidateBackup).mockReset()
  vi.mocked(applyBackup).mockReset().mockResolvedValue({ ok: true })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ''
  delete globalWithChrome.chrome
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  toast.dismiss()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

describe('OptionsPage 首屏读取与归一化', () => {
  it('读取 sync.settings 并渲染完整配置，挂载阶段不写存储', async () => {
    const stored: Settings = {
      ...BASE(),
      theme: 'dark',
      quickOpen: false,
      ballDockMode: 'bottomRight',
      ballSnap: false,
      ballBottomRightRight: 200,
      ballBottomRightBottom: 60,
      fontScale: 1.1,
      ballShape: 'circle',
      ballPreset: 'soft',
      ballSize: 'lg',
      ballAction: 'native',
      ballBlacklist: ['keep.com'],
      toolEnabled: { ...BASE().toolEnabled, jwt: true },
    }
    await mount(stored)

    expect(container.querySelector('h1')?.textContent).toContain(i18n.t('settings.title'))
    expect(selectText('主题')).toBe('深色')
    expect(selectText('整体字体大小')).toBe('较大')
    expect(selectText('停靠行为')).toBe('固定右下角')
    expect(selectText('默认唤起方式')).toBe('浏览器原生侧边栏')
    expect(selectText('形状')).toBe('圆形')
    expect(selectText('大小')).toBe('大')
    expect(ballToggle().getAttribute('aria-checked')).toBe('false')
    // 固定右下角模式才出现边距输入，值来自存储
    const offsets = [...container.querySelectorAll<HTMLInputElement>('.opt__offset-input')]
    expect(offsets.map((i) => i.value)).toEqual(['200', '60'])
    expect(
      container
        .querySelector('button[role="radio"][aria-label="柔和"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true')
    expect(textarea().value).toBe('keep.com')

    const rows = toolRows()
    expect(rows.map((r) => r.name)).toEqual(
      DEFAULT_TOOLS.map((t) => i18n.t(`tool.registry.${t.id}`)),
    )
    expect(rows.find((r) => r.name === 'JWT')?.on).toBe(true)

    // 首屏只读不写：不能因为读取就把默认值回写覆盖用户数据
    expect(syncCalls()).toHaveLength(0)
    expectNoRawKeys()
  })

  it('残缺 / 非法数据回退默认，不崩也不写回', async () => {
    await mount({
      theme: 'neon',
      locale: 'fr',
      fontScale: 2,
      ballShape: 'triangle',
      ballPreset: 'x',
      ballSize: 'xxl',
      ballAction: 'bogus',
      ballDockMode: 'bogus',
      ballSnap: false,
      ballBottomRightRight: 99999,
      ballBottomRightBottom: 'abc',
      ballDomainMode: 'nope',
      ballBlacklist: 'nope',
      ballWhitelist: [null, '  ', 'A.com', 'a.com'],
    })

    expect(selectText('主题')).toBe('跟随系统')
    expect(selectText('语言')).toBe('跟随系统')
    expect(selectText('整体字体大小')).toBe('标准')
    expect(selectText('形状')).toBe('圆角矩形')
    expect(selectText('大小')).toBe('中')
    expect(selectText('默认唤起方式')).toBe('网页内抽屉')
    // ballDockMode 非法但 ballSnap=false → 迁移为自由停靠（向后兼容旧字段）
    expect(selectText('停靠行为')).toBe('自由停靠')
    // 非数组黑名单归一化为空
    expect(textarea().value).toBe('')
    // 白名单里的非字符串被丢弃，字符串 trim + 小写 + 去重
    fire(domainTab('白名单域名'), 'click')
    expect(textarea().value).toBe('a.com')

    expect(syncCalls()).toHaveLength(0)
  })

  it('storage 里没有 settings 时按默认渲染（locale=system 跟随系统语言）', async () => {
    await mount()

    expect(container.querySelector('h1')?.textContent).toContain('Panda Dock 设置')
    expect(ballToggle().getAttribute('aria-checked')).toBe('true')
    expect(selectText('主题')).toBe('跟随系统')
    const rows = toolRows()
    expect(rows).toHaveLength(DEFAULT_TOOLS.length)
    expect(rows.find((r) => r.name === 'JWT')?.on).toBe(false)
    expect(rows.find((r) => r.name === '哈希')?.on).toBe(false)
    expect(syncCalls()).toHaveLength(0)
  })

  it('固定右下角模式：边距数字输入渲染并做范围夹紧（9999 → 800）', async () => {
    await mount({ ...BASE(), ballDockMode: 'bottomRight', ballBottomRightRight: 9999 })
    const offsets = [...container.querySelectorAll<HTMLInputElement>('.opt__offset-input')]
    expect(offsets.map((i) => i.value)).toEqual(['800', '80'])
  })
})

describe('OptionsPage 设置项交互：每次都写入完整 Settings', () => {
  it('切换主题：写入完整对象并即时应用 data-theme', async () => {
    await mount(BASE())
    choose('主题', '深色')

    const written = writtenSettings()
    expect(written).toEqual({ ...BASE(), theme: 'dark' })
    expectFullSettings(written)
    expect(syncCalls()).toHaveLength(1)
    // useTheme 监听 onChanged 后立即落到 documentElement
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('切换字体缩放：写入完整对象并应用 --tk-font-scale', async () => {
    await mount(BASE())
    choose('整体字体大小', '最大')

    const written = writtenSettings()
    expect(written).toEqual({ ...BASE(), fontScale: 1.25 })
    expectFullSettings(written)
    expect(document.documentElement.style.getPropertyValue('--tk-font-scale')).toBe('1.25')
  })

  it('切换语言：中英双向切换，且只保留完整设置对象', async () => {
    await mount(BASE())
    expect(container.querySelector('h1')?.textContent).toContain('Panda Dock 设置')

    choose('语言', 'English')
    // useLocale 监听 onChanged，写入后页面立即切成英文
    await settle()
    expect(writtenSettings().locale).toBe('en')
    expect(container.textContent).toContain('Panda Dock Settings')
    expect(container.textContent).not.toContain('Panda Dock 设置')
    expectNoRawKeys()

    choose('Language', '中文')
    await settle()
    expect(writtenSettings().locale).toBe('zh')
    expect(container.textContent).toContain('Panda Dock 设置')
    expect(container.textContent).not.toContain('Panda Dock Settings')
    expect(i18n.language).toBe('zh')
  })

  it('悬浮球总开关：开关状态与存储同步更新', async () => {
    await mount(BASE())
    fire(ballToggle(), 'click')

    expect(writtenSettings()).toEqual({ ...BASE(), quickOpen: false })
    expectFullSettings(writtenSettings())
    expect(ballToggle().getAttribute('aria-checked')).toBe('false')

    fire(ballToggle(), 'click')
    expect(writtenSettings()).toEqual(BASE())
    expect(ballToggle().getAttribute('aria-checked')).toBe('true')
  })

  it('停靠模式：切换为固定右下角时 ballSnap 同步为 false，编辑边距保留其余字段', async () => {
    await mount(BASE())
    choose('停靠行为', '固定右下角')
    expect(writtenSettings()).toEqual({
      ...BASE(),
      ballDockMode: 'bottomRight',
      ballSnap: false,
    })
    expectFullSettings(writtenSettings())

    const [right, bottom] = [...container.querySelectorAll<HTMLInputElement>('.opt__offset-input')]
    act(() => {
      setNativeValue(right, '150')
      setNativeValue(bottom, '40')
    })
    const written = writtenSettings()
    expect(written.ballBottomRightRight).toBe(150)
    expect(written.ballBottomRightBottom).toBe(40)
    expect(written.ballDockMode).toBe('bottomRight')
    expectFullSettings(written)

    // 自动吸边时 ballSnap 回到 true；已编辑的边距值保留，不被重置
    choose('停靠行为', '自动吸边')
    expect(writtenSettings()).toEqual({
      ...BASE(),
      ballDockMode: 'edge',
      ballSnap: true,
      ballBottomRightRight: 150,
      ballBottomRightBottom: 40,
    })
  })

  it('点击动作 / 形状 / 预设 / 大小：逐项写入完整对象', async () => {
    await mount(BASE())
    expect(container.textContent).toContain('数据仅在当前标签页内有效')

    choose('默认唤起方式', '浏览器原生侧边栏')
    expect(writtenSettings()).toEqual({ ...BASE(), ballAction: 'native' })
    expectFullSettings(writtenSettings())
    expect(container.textContent).toContain('所有页面共用同一份数据')

    choose('形状', '圆形')
    expect(writtenSettings()).toEqual({ ...BASE(), ballAction: 'native', ballShape: 'circle' })

    fire(container.querySelector('button[role="radio"][aria-label="描边"]') as Element, 'click')
    expect(writtenSettings().ballPreset).toBe('outline')
    expectFullSettings(writtenSettings())

    choose('大小', '大')
    expect(writtenSettings()).toEqual({
      ...BASE(),
      ballAction: 'native',
      ballShape: 'circle',
      ballPreset: 'outline',
      ballSize: 'lg',
    })
  })

  it('域名模式切换 + 黑名单归一化（trim / 小写 / 去重）与计数', async () => {
    await mount(BASE())
    choose('规则模式', '白名单模式（仅在名单内的网站中显示悬浮球）')
    expect(writtenSettings().ballDomainMode).toBe('whitelist')

    // 切回黑名单页签编辑
    fire(domainTab('黑名单域名'), 'click')
    act(() => {
      setNativeValue(
        textarea(),
        '  GitHub.com \nhttps://Example.com/path?x=1\n\ngithub.com\nlocalhost:3000\ngithub.com',
      )
    })
    act(() => {
      textarea().focus()
      textarea().blur()
    })

    const written = writtenSettings()
    expect(written.ballBlacklist).toEqual(['github.com', 'example.com', 'localhost:3000'])
    expect(written.ballDomainMode).toBe('whitelist')
    expectFullSettings(written)
    // 输入框内容被就地规整，计数同步
    expect(textarea().value).toBe('github.com\nexample.com\nlocalhost:3000')
    expect(container.textContent).toContain(i18n.t('settings.domainCount', { count: 3 }))
  })

  it('白名单页签的编辑同样归一化后写入 ballWhitelist', async () => {
    await mount(BASE())
    fire(domainTab('白名单域名'), 'click')
    act(() => {
      setNativeValue(textarea(), ' WwW.Example.COM , b.com\nA.com ')
    })
    act(() => {
      textarea().focus()
      textarea().blur()
    })

    const written = writtenSettings()
    expect(written.ballWhitelist).toEqual(['www.example.com', 'b.com', 'a.com'])
    expect(written.ballBlacklist).toEqual([])
    expectFullSettings(written)
  })

  it('域名列表可删减：删掉一条后失焦写入的名单只剩剩余规则', async () => {
    await mount({ ...BASE(), ballBlacklist: ['a.com', 'b.com', 'c.com'] })
    expect(textarea().value).toBe('a.com\nb.com\nc.com')

    act(() => {
      setNativeValue(textarea(), 'a.com\nc.com')
    })
    act(() => {
      textarea().focus()
      textarea().blur()
    })

    const written = writtenSettings()
    expect(written.ballBlacklist).toEqual(['a.com', 'c.com'])
    // 只丢被删的那条，其他设置（如主题）不受影响
    expect(written.theme).toBe(BASE().theme)
    expectFullSettings(written)
  })

  it('分区块「恢复默认」只影响本区块，其余用户配置保留', async () => {
    await mount({
      ...BASE(),
      theme: 'dark',
      fontScale: 1.25,
      ballShape: 'circle',
      ballPreset: 'soft',
      ballSize: 'lg',
      ballBlacklist: ['keep.com'],
      ballWhitelist: ['only.com'],
      ballDomainMode: 'whitelist',
      quickOpen: false,
      ballAction: 'native',
    })

    fire(resetButtonOf('外观与显示'), 'click')
    expect(writtenSettings()).toEqual({
      ...BASE(),
      theme: 'system',
      locale: 'system',
      fontScale: 1,
      ballShape: 'circle',
      ballPreset: 'soft',
      ballSize: 'lg',
      ballBlacklist: ['keep.com'],
      ballWhitelist: ['only.com'],
      ballDomainMode: 'whitelist',
      quickOpen: false,
      ballAction: 'native',
    })

    fire(resetButtonOf('域名显示规则'), 'click')
    const afterDomain = writtenSettings()
    expect(afterDomain.ballDomainMode).toBe('blacklist')
    expect(afterDomain.ballBlacklist).toEqual([])
    expect(afterDomain.ballWhitelist).toEqual([])
    // 其他区块（外观 / 悬浮球）的当前值不能被牵连
    expect(afterDomain.theme).toBe('system')
    expect(afterDomain.ballShape).toBe('circle')
    expect(textarea().value).toBe('')

    fire(resetButtonOf('悬浮球与唤起方式'), 'click')
    const afterBall = writtenSettings()
    expect(afterBall.quickOpen).toBe(true)
    expect(afterBall.ballDockMode).toBe('edge')
    expect(afterBall.ballSnap).toBe(true)
    expect(afterBall.ballAction).toBe('drawer')
    expect(afterBall.ballShape).toBe('circle')

    fire(resetButtonOf('悬浮球样式'), 'click')
    const afterStyle = writtenSettings()
    expect(afterStyle.ballShape).toBe('rounded')
    expect(afterStyle.ballPreset).toBe('primary')
    expect(afterStyle.ballSize).toBe('md')
    expect(afterStyle.theme).toBe('system')
    expectFullSettings(afterStyle)
  })
})

describe('OptionsPage 工具列表：显隐与顺序配置', () => {
  it('normalizeToolLayout 语义：残缺顺序补齐全部工具、新工具出现在列表、隐藏项可开启', async () => {
    await mount({ ...BASE(), toolOrder: ['json', 'detect'], toolEnabled: { jwt: true } })

    const rows = toolRows()
    expect(rows.map((r) => r.name)).toEqual([
      'JSON',
      '智能解析',
      '网页存储',
      'Base64',
      '网址',
      '时间戳',
      '二维码',
      'JWT',
      '哈希',
    ])
    // 存储里显式开启的 JWT 必须开着，未被存储的按产品默认（hash 隐藏）
    expect(rows.find((r) => r.name === 'JWT')?.on).toBe(true)
    expect(rows.find((r) => r.name === '哈希')?.on).toBe(false)

    // 隐藏项可以一键开启，且写入的是完整 toolEnabled
    fire(toolSwitch('哈希'), 'click')
    const written = writtenSettings()
    expect(written.toolEnabled.hash).toBe(true)
    expect(written.toolEnabled.jwt).toBe(true)
    expect(written.toolOrder).toHaveLength(DEFAULT_TOOLS.length)
    expectFullSettings(written)
  })

  it('显隐开关不改动 toolOrder，用户自定义顺序被原样保留', async () => {
    await mount({ ...BASE(), toolOrder: ['hash', 'jwt', 'detect'] })
    const expectedOrder = [
      'hash',
      'jwt',
      'detect',
      'storage',
      'base64',
      'json',
      'url',
      'timestamp',
      'qrcode',
    ]

    fire(toolSwitch('Base64'), 'click')
    const written = writtenSettings()
    expect(written.toolEnabled.base64).toBe(false)
    expect(written.toolOrder).toEqual(expectedOrder)
    expectFullSettings(written)
  })

  it('恢复默认布局：toolOrder 回到注册表顺序、toolEnabled 回到产品默认', async () => {
    await mount({ ...BASE(), toolOrder: ['hash', 'jwt'], toolEnabled: { jwt: true } })
    fire(resetButtonOf('工具箱'), 'click')

    const written = writtenSettings()
    expect(written.toolOrder).toEqual(DEFAULT_TOOLS.map((t) => t.id))
    expect(written.toolEnabled).toEqual(defaultToolLayout().enabled)
    expect(written.toolOrder).toHaveLength(DEFAULT_TOOLS.length)
    expectFullSettings(written)
  })
})

describe('OptionsPage 破坏性操作：ConfirmDialog 二次确认', () => {
  it('全局恢复默认取消不写数据、确认才写，且从不调用 window.confirm', async () => {
    const confirmSpy = vi.fn()
    vi.stubGlobal('confirm', confirmSpy)
    await mount({ ...BASE(), theme: 'dark' })

    const dangerButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === i18n.t('settings.restoreDefaults'),
    )
    fire(dangerButton as Element, 'click')

    const dialog = container.querySelector<HTMLElement>('.tk-modal')
    expect(dialog?.getAttribute('role')).toBe('alertdialog')
    expect(dialog?.querySelector('.tk-modal__title')?.textContent).toBe(
      i18n.t('settings.restoreDefaultsConfirmTitle'),
    )
    // 统一走 ConfirmDialog（§4 第 14 条），绝不能回落到原生 confirm
    expect(confirmSpy).not.toHaveBeenCalled()

    // 取消：弹窗关闭、存储没有任何写入、表单保持用户当前值
    fire(dialog?.querySelector('button.tk-btn:not(.tk-btn--danger)') as Element, 'click')
    expect(container.querySelector('.tk-modal')).toBeNull()
    expect(syncCalls()).toHaveLength(0)
    expect(selectText('主题')).toBe('深色')

    // 确认：提交 defaultSettings()，并把自定义图片一并清空（sync + local 两处）
    fire(dangerButton as Element, 'click')
    const dangerDialog = container.querySelector<HTMLElement>('.tk-modal')
    fire(dangerDialog?.querySelector('button.tk-btn--danger') as Element, 'click')

    expect(container.querySelector('.tk-modal')).toBeNull()
    expect(syncCalls()).toHaveLength(1)
    expect(writtenSettings()).toEqual(defaultSettings())
    expectFullSettings(writtenSettings())
    expect(chromeState.local.ballImage).toBeNull()
    expect(selectText('主题')).toBe('跟随系统')
  })
})

describe('OptionsPage 写入失败不静默', () => {
  it('saveSettings 失败时弹出 saveFailed 提示，用户不会误以为已保存', async () => {
    await mount(BASE())
    chromeState.failSyncSet = true

    choose('主题', '深色')
    await settle()

    expect(container.querySelector('.tk-toast__title')?.textContent).toBe(
      i18n.t('settings.saveFailed'),
    )
    // 失败不影响本地乐观更新（下次进入仍会从存储读到旧值）
    expect(selectText('主题')).toBe('深色')
  })
})

describe('OptionsPage 自定义悬浮球图片（chrome.storage.local）', () => {
  it('选择合法图片：写 local、不写 sync，并显示预览与移除按钮', async () => {
    await mount(BASE())
    pickFile(imageInput(), new File(['fake-image-bytes'], 'logo.png', { type: 'image/png' }))

    await waitFor(() => {
      expect(String(chromeState.local.ballImage)).toMatch(/^data:image\/png;base64,/)
      expect(container.querySelector('img[src^="data:image/"]')).not.toBeNull()
    })
    // 图片绝不能塞进 sync（8KB 配额，§5）
    expect(syncCalls()).toHaveLength(0)
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('button')].some(
        (b) => b.textContent === i18n.t('settings.ballImageRemove'),
      ),
    ).toBe(true)
    expect(container.querySelector('.opt__env--error')).toBeNull()
  })

  it('超过 128KB 的图片被本地拒绝并提示，不写任何存储', async () => {
    await mount(BASE())
    pickFile(
      imageInput(),
      new File([new Uint8Array(BALL_IMAGE_MAX_BYTES + 1)], 'big.png', { type: 'image/png' }),
    )
    await waitFor(() =>
      expect(container.querySelector('.opt__env--error')?.textContent).toBe(
        i18n.t('settings.ballImageTooLarge'),
      ),
    )
    expect(chromeState.local.ballImage).toBeUndefined()
    expect(syncCalls()).toHaveLength(0)
  })

  it('非图片类型被拒绝并提示', async () => {
    await mount(BASE())
    pickFile(imageInput(), new File(['hello'], 'note.txt', { type: 'text/plain' }))

    await waitFor(() =>
      expect(container.querySelector('.opt__env--error')?.textContent).toBe(
        i18n.t('settings.ballImageTypeError'),
      ),
    )
    expect(chromeState.local.ballImage).toBeUndefined()
  })

  it('local 写入失败时提示 ballImageSaveFailed，而不是静默', async () => {
    await mount(BASE())
    chromeState.failLocalSet = true
    pickFile(imageInput(), new File(['fake-image-bytes'], 'logo.png', { type: 'image/png' }))

    await waitFor(() =>
      expect(container.querySelector('.opt__env--error')?.textContent).toBe(
        i18n.t('settings.ballImageSaveFailed'),
      ),
    )
    expect(chromeState.local.ballImage).toBeUndefined()
  })

  it('移除图片需先确认：取消不删、确认才把 local 置空并撤掉预览', async () => {
    await mount(BASE())
    pickFile(imageInput(), new File(['fake-image-bytes'], 'logo.png', { type: 'image/png' }))
    await waitFor(() => expect(container.querySelector('img[src^="data:image/"]')).not.toBeNull())

    const removeButton = () =>
      [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === i18n.t('settings.ballImageRemove'),
      ) as HTMLButtonElement

    // 第一次点击只弹确认框：图片属于不可恢复的本地数据（§8），不能直接删
    fire(removeButton(), 'click')
    const dialog = container.querySelector<HTMLElement>('.tk-modal')
    expect(dialog?.getAttribute('role')).toBe('alertdialog')
    expect(dialog?.querySelector('.tk-modal__title')?.textContent).toBe(
      i18n.t('settings.ballImageRemoveConfirmTitle'),
    )
    expect(chromeState.local.ballImage).not.toBeNull()

    // 取消：图片与预览都保留
    fire(dialog?.querySelector('button.tk-btn:not(.tk-btn--danger)') as Element, 'click')
    await settle(10)
    expect(container.querySelector('.tk-modal')).toBeNull()
    expect(chromeState.local.ballImage).not.toBeNull()
    expect(container.querySelector('img[src^="data:image/"]')).not.toBeNull()

    // 确认：local 置空、预览消失
    fire(removeButton(), 'click')
    fire(container.querySelector('.tk-modal button.tk-btn--danger') as Element, 'click')
    await settle(10)

    expect(container.querySelector('.tk-modal')).toBeNull()
    expect(chromeState.local.ballImage).toBeNull()
    expect(container.querySelector('img[src^="data:image/"]')).toBeNull()
  })

  it('有自定义图片时恢复悬浮球样式需确认；确认后形状回默认并清空图片', async () => {
    await mount({ ...BASE(), ballShape: 'circle' })
    pickFile(imageInput(), new File(['fake-image-bytes'], 'logo.png', { type: 'image/png' }))
    await waitFor(() => expect(container.querySelector('img[src^="data:image/"]')).not.toBeNull())

    fire(resetButtonOf('悬浮球样式'), 'click')
    const dialog = container.querySelector<HTMLElement>('.tk-modal')
    expect(dialog?.querySelector('.tk-modal__title')?.textContent).toBe(
      i18n.t('settings.ballStyleResetConfirmTitle'),
    )

    // 取消：样式与图片都不动
    fire(dialog?.querySelector('button.tk-btn:not(.tk-btn--danger)') as Element, 'click')
    await settle(10)
    expect(chromeState.local.ballImage).not.toBeNull()
    expect(container.querySelector('img[src^="data:image/"]')).not.toBeNull()

    // 确认：形状回默认 + 图片清空
    fire(resetButtonOf('悬浮球样式'), 'click')
    fire(container.querySelector('.tk-modal button.tk-btn--danger') as Element, 'click')
    await settle(10)

    expect(writtenSettings().ballShape).toBe('rounded')
    expect(chromeState.local.ballImage).toBeNull()
    expect(container.querySelector('img[src^="data:image/"]')).toBeNull()
  })

  it('没有自定义图片时恢复悬浮球样式直接生效，不弹确认框', async () => {
    await mount({ ...BASE(), ballShape: 'circle' })

    fire(resetButtonOf('悬浮球样式'), 'click')
    await settle(10)

    expect(container.querySelector('.tk-modal')).toBeNull()
    expect(writtenSettings().ballShape).toBe('rounded')
  })
})

describe('OptionsPage 配置备份：导入 / 导出', () => {
  it('导出：把当前完整设置交给 exportSettingsBackup，导出中按钮禁用', async () => {
    let finishExport: () => void = () => {}
    vi.mocked(exportSettingsBackup).mockReturnValue(
      new Promise<void>((resolve) => {
        finishExport = () => resolve()
      }),
    )
    const stored = { ...BASE(), theme: 'dark' as const }
    await mount(stored)

    const exportBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(i18n.t('settings.exportSettingsBtn')),
    ) as HTMLButtonElement
    fire(exportBtn, 'click')

    expect(vi.mocked(exportSettingsBackup)).toHaveBeenCalledWith(stored)
    expect(exportBtn.disabled).toBe(true)

    await act(async () => {
      finishExport()
    })
    expect(exportBtn.disabled).toBe(false)
  })

  it('导入合法备份：应用设置与图片、提示成功并弹出成功确认框', async () => {
    const imported: Settings = {
      ...BASE(),
      theme: 'dark',
      quickOpen: false,
      ballBlacklist: ['a.com'],
    }
    vi.mocked(parseAndValidateBackup).mockReturnValue({
      ok: true,
      settings: imported,
      ballImage: 'data:image/png;base64,AAAA',
    })
    await mount(BASE())

    pickFile(importInput(), new File(['{}'], 'backup.json', { type: 'application/json' }))

    await waitFor(() =>
      expect(vi.mocked(applyBackup)).toHaveBeenCalledWith({
        settings: imported,
        ballImage: 'data:image/png;base64,AAAA',
      }),
    )
    // 导入后 UI 即时同步
    expect(selectText('主题')).toBe('深色')
    expect(ballToggle().getAttribute('aria-checked')).toBe('false')
    expect(container.textContent).toContain(i18n.t('settings.importSuccess'))

    const dialog = container.querySelector<HTMLElement>('.tk-modal')
    expect(dialog?.querySelector('.tk-modal__title')?.textContent).toBe(
      i18n.t('settings.importSuccessTitle'),
    )
    fire(dialog?.querySelector('button.tk-btn--primary') as Element, 'click')
    expect(container.querySelector('.tk-modal')).toBeNull()
  })

  it('导入非法文件：只报对应错误，不调用 applyBackup、不弹成功框', async () => {
    vi.mocked(parseAndValidateBackup).mockReturnValue({
      ok: false,
      errorKey: 'settings.importInvalidJson',
    })
    await mount(BASE())

    pickFile(importInput(), new File(['not json'], 'backup.json', { type: 'application/json' }))

    await waitFor(() =>
      expect(container.querySelector('.tk-toast__title')?.textContent).toBe(
        i18n.t('settings.importInvalidJson'),
      ),
    )
    expect(vi.mocked(applyBackup)).not.toHaveBeenCalled()
    expect(container.querySelector('.tk-modal')).toBeNull()
  })

  it('导入时 sync 写入失败：提示 saveFailed 且不进入成功态', async () => {
    vi.mocked(parseAndValidateBackup).mockReturnValue({
      ok: true,
      settings: BASE(),
      ballImage: null,
    })
    vi.mocked(applyBackup).mockResolvedValue({ ok: false, reason: 'settings' })
    await mount(BASE())

    pickFile(importInput(), new File(['{}'], 'backup.json', { type: 'application/json' }))

    await waitFor(() =>
      expect(container.querySelector('.tk-toast__title')?.textContent).toBe(
        i18n.t('settings.saveFailed'),
      ),
    )
    expect(container.querySelector('.tk-modal')).toBeNull()
  })

  it('导入时图片写入失败：提示 ballImageSaveFailed', async () => {
    vi.mocked(parseAndValidateBackup).mockReturnValue({
      ok: true,
      settings: BASE(),
      ballImage: 'data:image/png;base64,AAAA',
    })
    vi.mocked(applyBackup).mockResolvedValue({ ok: false, reason: 'ballImage' })
    await mount(BASE())

    pickFile(importInput(), new File(['{}'], 'backup.json', { type: 'application/json' }))

    await waitFor(() =>
      expect(container.querySelector('.tk-toast__title')?.textContent).toBe(
        i18n.t('settings.ballImageSaveFailed'),
      ),
    )
    expect(container.querySelector('.tk-modal')).toBeNull()
  })
})

describe('OptionsPage 非扩展环境（pnpm dev 预览）', () => {
  it('无 chrome 时展示预览模式，交互不写存储也不崩', async () => {
    delete globalWithChrome.chrome
    await act(async () => {
      root.render(<OptionsPage />)
    })
    await settle()

    expect(container.textContent).toContain(i18n.t('settings.previewMode'))
    fire(ballToggle(), 'click')
    expect(ballToggle().getAttribute('aria-checked')).toBe('false')
    expectNoRawKeys()
  })
})
