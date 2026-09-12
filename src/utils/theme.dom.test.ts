// @vitest-environment happy-dom
import { act, createElement } from 'react'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, HOST_ID, useTheme } from './theme'

/**
 * 主题落点是最容易「看起来对、实际漏」的地方：
 * - 扩展页面必须写 documentElement，content script 必须只写 Shadow DOM 宿主，
 *   写错就会污染宿主网页的 <html>（§4 第 12 条：主题靠 data-theme + --tk-* 令牌）；
 * - content script 里 `:host[data-theme]` 的级联覆盖有坑，所以还要把配色内联到宿主，
 *   这里断言的是「内联后的真实 CSS 变量值」，而不是函数被调用了。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

/** light / dark 两套令牌里的代表值，用来验证「配色真的按主题换了一套」 */
const LIGHT_BACKGROUND = 'hsl(0 0% 99%)'
const DARK_BACKGROUND = 'hsl(240 10% 4%)'
const LIGHT_FOREGROUND = 'hsl(240 9% 9%)'
const DARK_FOREGROUND = 'hsl(0 0% 98%)'
const LIGHT_PRIMARY = '#171717'
const DARK_PRIMARY = 'hsl(0 0% 96%)'

let changeListeners: ChangeListener[]
let syncStore: Record<string, unknown>

/** 内存版 chrome 桩：get 读内存，onChanged 记录监听器以便测试主动派发 */
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

/** 扩展环境最小桩：isExtension 只认 chrome.runtime.id */
function stubExtension() {
  globalWithChrome.chrome = { runtime: { id: 'test-extension-id' } }
}

type MediaQueryHandler = () => void

/** 可控的 matchMedia 桩：matches 可改、change 监听可手动触发、可数监听器数量 */
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  let handlers: MediaQueryHandler[] = []
  const mql = {
    get matches() {
      return matches
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, handler: MediaQueryHandler) => {
      handlers.push(handler)
    },
    removeEventListener: (_type: string, handler: MediaQueryHandler) => {
      handlers = handlers.filter((item) => item !== handler)
    },
    addListener: (handler: MediaQueryHandler) => {
      handlers.push(handler)
    },
    removeListener: (handler: MediaQueryHandler) => {
      handlers = handlers.filter((item) => item !== handler)
    },
  } as unknown as MediaQueryList

  vi.stubGlobal('matchMedia', () => mql)

  return {
    setMatches(next: boolean) {
      matches = next
    },
    fireChange() {
      for (const handler of [...handlers]) handler()
    },
    listenerCount: () => handlers.length,
  }
}

function createHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)
  return host
}

const cssVar = (el: HTMLElement, name: string) => el.style.getPropertyValue(name)

function Probe() {
  useTheme()
  return createElement('span', { 'data-testid': 'mounted' }, 'mounted')
}

let container: HTMLDivElement
let root: Root

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const emitChange = (newValue: unknown, areaName = 'sync') => {
  act(() => {
    for (const listener of [...changeListeners]) listener({ settings: { newValue } }, areaName)
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.getElementById(HOST_ID)?.remove()
  // 清掉内联令牌与 data-theme，避免用例互相污染
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  delete globalWithChrome.chrome
  vi.unstubAllGlobals()
})

describe('applyTheme 的落点与令牌内联', () => {
  it('无宿主且非扩展（dev 预览）：写 documentElement 并内联 light 令牌', () => {
    stubMatchMedia(false)

    applyTheme('light')

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(cssVar(document.documentElement, '--tk-background')).toBe(LIGHT_BACKGROUND)
    expect(cssVar(document.documentElement, '--tk-foreground')).toBe(LIGHT_FOREGROUND)
    expect(cssVar(document.documentElement, '--tk-primary')).toBe(LIGHT_PRIMARY)
  })

  it('无宿主且非扩展：dark 直接生效，内联的是 dark 一套令牌', () => {
    stubMatchMedia(false)

    applyTheme('dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(cssVar(document.documentElement, '--tk-background')).toBe(DARK_BACKGROUND)
    expect(cssVar(document.documentElement, '--tk-foreground')).toBe(DARK_FOREGROUND)
    expect(cssVar(document.documentElement, '--tk-primary')).toBe(DARK_PRIMARY)
  })

  it('存在宿主且处于扩展环境（content script）：只写宿主，绝不碰 documentElement', () => {
    stubMatchMedia(false)
    stubExtension()
    const host = createHost()

    applyTheme('dark')

    expect(host.dataset.theme).toBe('dark')
    expect(cssVar(host, '--tk-background')).toBe(DARK_BACKGROUND)
    expect(cssVar(host, '--tk-foreground')).toBe(DARK_FOREGROUND)
    expect(cssVar(host, '--tk-primary')).toBe(DARK_PRIMARY)

    // 宿主网页的 <html> 必须保持原样，否则内容是「泄漏」到宿主页面上
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(cssVar(document.documentElement, '--tk-background')).toBe('')
  })

  it('存在宿主但非扩展（dev 预览）：宿主与 documentElement 都写', () => {
    stubMatchMedia(false)
    const host = createHost()

    applyTheme('light')

    expect(host.dataset.theme).toBe('light')
    expect(cssVar(host, '--tk-background')).toBe(LIGHT_BACKGROUND)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(cssVar(document.documentElement, '--tk-background')).toBe(LIGHT_BACKGROUND)
  })

  it('system 走 matchMedia：matches=true → dark，matches=false → light', () => {
    const media = stubMatchMedia(true)

    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(cssVar(document.documentElement, '--tk-background')).toBe(DARK_BACKGROUND)

    media.setMatches(false)
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(cssVar(document.documentElement, '--tk-background')).toBe(LIGHT_BACKGROUND)
  })

  it('反复调用幂等，mode 变化时旧令牌被新主题覆盖', () => {
    stubMatchMedia(false)

    applyTheme('dark')
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(cssVar(document.documentElement, '--tk-primary')).toBe(DARK_PRIMARY)

    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(cssVar(document.documentElement, '--tk-primary')).toBe(LIGHT_PRIMARY)
    expect(cssVar(document.documentElement, '--tk-background')).toBe(LIGHT_BACKGROUND)
  })

  it('存在宿主时反复应用不会把宿主令牌留在旧主题上', () => {
    stubMatchMedia(false)
    stubExtension()
    const host = createHost()

    applyTheme('dark')
    applyTheme('light')

    expect(host.dataset.theme).toBe('light')
    expect(cssVar(host, '--tk-background')).toBe(LIGHT_BACKGROUND)
    expect(cssVar(host, '--tk-primary')).toBe(LIGHT_PRIMARY)
  })
})

describe('useTheme 读取设置与实时切换', () => {
  it('初始按 system 应用（系统深色时立即深色），存档无 theme 时保持', async () => {
    stubChrome({ settings: {} })
    const media = stubMatchMedia(true)

    await act(async () => {
      root.render(createElement(Probe))
    })
    expect(document.documentElement.dataset.theme).toBe('dark')

    await flush()
    expect(document.documentElement.dataset.theme).toBe('dark')

    media.setMatches(false)
    act(() => media.fireChange())
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('读到 settings.theme=dark 后 documentElement 变 dark', async () => {
    stubChrome({ settings: { theme: 'dark' } })
    stubMatchMedia(false)

    // 用同步 act 只提交首帧：此时存档还没读回来，先按系统（light）落色，避免闪烁
    act(() => {
      root.render(createElement(Probe))
    })
    expect(document.documentElement.dataset.theme).toBe('light')

    await flush()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(cssVar(document.documentElement, '--tk-background')).toBe(DARK_BACKGROUND)
  })

  it('存在宿主时读到 dark：宿主变 dark 且不写 documentElement', async () => {
    stubChrome({ settings: { theme: 'dark' } })
    stubMatchMedia(false)
    const host = createHost()

    await act(async () => {
      root.render(createElement(Probe))
    })
    await flush()

    expect(host.dataset.theme).toBe('dark')
    expect(cssVar(host, '--tk-background')).toBe(DARK_BACKGROUND)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('onChanged 推送新主题即时切换（无需重挂载）', async () => {
    stubChrome({ settings: { theme: 'light' } })
    stubMatchMedia(false)

    await act(async () => {
      root.render(createElement(Probe))
    })
    await flush()
    expect(document.documentElement.dataset.theme).toBe('light')

    emitChange({ theme: 'dark' })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(cssVar(document.documentElement, '--tk-background')).toBe(DARK_BACKGROUND)

    emitChange({ theme: 'light' })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(cssVar(document.documentElement, '--tk-background')).toBe(LIGHT_BACKGROUND)
  })

  it('onChanged 里的非法主题（blue / 缺失）被忽略，保持当前主题', async () => {
    stubChrome({ settings: { theme: 'dark' } })
    stubMatchMedia(false)

    await act(async () => {
      root.render(createElement(Probe))
    })
    await flush()
    expect(document.documentElement.dataset.theme).toBe('dark')

    emitChange({ theme: 'blue' })
    expect(document.documentElement.dataset.theme).toBe('dark')

    emitChange({})
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('onChanged 只响应 sync 区域', async () => {
    stubChrome({ settings: { theme: 'light' } })
    stubMatchMedia(false)

    await act(async () => {
      root.render(createElement(Probe))
    })
    await flush()

    emitChange({ theme: 'dark' }, 'local')
    expect(document.documentElement.dataset.theme).toBe('light')

    emitChange({ theme: 'dark' }, 'sync')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('卸载后移除 onChanged 与 matchMedia 监听', async () => {
    stubChrome({ settings: { theme: 'dark' } })
    const media = stubMatchMedia(false)

    await act(async () => {
      root.render(createElement(Probe))
    })
    await flush()
    expect(changeListeners).toHaveLength(1)
    expect(media.listenerCount()).toBe(1)

    act(() => root.unmount())
    expect(changeListeners).toHaveLength(0)
    expect(media.listenerCount()).toBe(0)

    root = createRoot(container)
  })

  it('chrome 完全缺失（pnpm dev 预览）时按 system 应用且不抛错', async () => {
    stubMatchMedia(true)

    await act(async () => {
      root.render(createElement(Probe))
    })
    await flush()

    expect(container.textContent).toBe('mounted')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('有 chrome 但无 chrome.runtime.id 时不注册 onChanged，存储读取仍生效', async () => {
    stubChrome({ runtimeId: null, settings: { theme: 'dark' } })
    stubMatchMedia(false)

    await act(async () => {
      root.render(createElement(Probe))
    })
    await flush()

    // storageGet 不依赖 runtime.id，读到的 dark 依然会应用
    expect(document.documentElement.dataset.theme).toBe('dark')
    // 但 onChanged 监听挂在 runtime.id 判定上，这里不应注册
    expect(changeListeners).toHaveLength(0)

    emitChange({ theme: 'light' })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

/**
 * 智能解析的高亮标记是**纯背景层**：可见文字由上层 textarea 用 `--tk-foreground` 绘制
 * （见 tools.css 的 `.tw-area-backdrop` / `.tw-area-input`），所以「文字色压在高亮底色上」的
 * 对比度就是可读性下限。浅色主题是浅黄底 + 深色字；深色主题必须反过来用**不透明的深色底**——
 * 曾经用过 `color-mix(… transparent)` 的半透明浅黄，深色主题下浅色文字压上去几乎看不见。
 *
 * 令牌值的唯一出处是 `src/theme.css`（Vitest 里 CSS 导入会被置空，所以直接读文件），
 * 这里按 WCAG 相对亮度算对比度，把「深色主题必须够深」这条不变量钉死在测试里。
 */
const MIN_CONTRAST = 4.5

/** 读 theme.css 并剥掉注释，只留声明，避免注释里出现的令牌名干扰取值 */
const themeCssText = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** 浅色令牌在前、深色覆盖块（`:root[data-theme='dark']`）在后，据此切分后取值 */
function tokenValue(theme: 'light' | 'dark', name: string): string {
  const [lightPart, darkPart = ''] = themeCssText.split(":root[data-theme='dark']")
  const matched = (theme === 'dark' ? darkPart : lightPart).match(
    new RegExp(`${name}:\\s*([^;]+);`),
  )
  if (!matched) throw new Error(`theme.css 的 ${theme} 主题里找不到 ${name}`)
  return matched[1].trim()
}

/** 解析 `#rrggbb` / `hsl(h s% l%)`；半透明写法（color-mix、rgb(… / 0.3)）无法参与对比度计算 */
function toRgb(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const int = Number.parseInt(hex[1], 16)
    return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255]
  }

  const hsl = value.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/)
  if (!hsl) throw new Error(`高亮/前景令牌必须是不透明的 #rrggbb 或 hsl()，无法解析：${value}`)

  const hue = Number(hsl[1]) / 360
  const saturation = Number(hsl[2]) / 100
  const lightness = Number(hsl[3]) / 100
  const channel = (n: number) => {
    const k = (n + hue * 12) % 12
    return (
      lightness -
      saturation * Math.min(lightness, 1 - lightness) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    )
  }
  return [channel(0), channel(8), channel(4)]
}

/** WCAG 2.x 相对亮度 */
function relativeLuminance(rgb: [number, number, number]): number {
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

/** WCAG 对比度（1:1 – 21:1） */
function contrastRatio(foreground: string, background: string): number {
  const [a, b] = [relativeLuminance(toRgb(foreground)), relativeLuminance(toRgb(background))]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** 某主题下，文字色（--tk-foreground）压在给定底色令牌上的对比度 */
const textOn = (theme: 'light' | 'dark', background: string) =>
  contrastRatio(tokenValue(theme, '--tk-foreground'), tokenValue(theme, background))

describe('高亮标记的可读性', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme} 主题：激活项高亮（--tk-highlight）上的文字对比度 ≥ ${MIN_CONTRAST}:1`, () => {
      expect(textOn(theme, '--tk-highlight')).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })

    it(`${theme} 主题：非激活项高亮（--tk-secondary）上的文字对比度 ≥ ${MIN_CONTRAST}:1`, () => {
      expect(textOn(theme, '--tk-secondary')).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })
  }
})
