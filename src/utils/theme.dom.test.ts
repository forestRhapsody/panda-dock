// @vitest-environment happy-dom
import { act, createElement } from 'react'

import { readdirSync, readFileSync } from 'node:fs'
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
const LIGHT_HIGHLIGHT = '#fef08a'
const DARK_HIGHLIGHT = '#fef08a'
const LIGHT_HIGHLIGHT_SECONDARY = '#fef9c3'
const DARK_HIGHLIGHT_SECONDARY = 'hsl(48 60% 25%)'

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
    expect(cssVar(document.documentElement, '--tk-highlight')).toBe(LIGHT_HIGHLIGHT)
    expect(cssVar(document.documentElement, '--tk-highlight-secondary')).toBe(
      LIGHT_HIGHLIGHT_SECONDARY,
    )
  })

  it('无宿主且非扩展：dark 直接生效，内联的是 dark 一套令牌', () => {
    stubMatchMedia(false)

    applyTheme('dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(cssVar(document.documentElement, '--tk-background')).toBe(DARK_BACKGROUND)
    expect(cssVar(document.documentElement, '--tk-foreground')).toBe(DARK_FOREGROUND)
    expect(cssVar(document.documentElement, '--tk-primary')).toBe(DARK_PRIMARY)
    expect(cssVar(document.documentElement, '--tk-highlight')).toBe(DARK_HIGHLIGHT)
    expect(cssVar(document.documentElement, '--tk-highlight-secondary')).toBe(
      DARK_HIGHLIGHT_SECONDARY,
    )
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
    expect(cssVar(host, '--tk-highlight')).toBe(DARK_HIGHLIGHT)
    expect(cssVar(host, '--tk-highlight-secondary')).toBe(DARK_HIGHLIGHT_SECONDARY)

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
 * 高亮标记的可读性：标记的**底色与文字色成对**取自令牌
 * （active = `--tk-highlight` / `--tk-highlight-foreground`，idle = `--tk-highlight-secondary` /
 * `--tk-highlight-secondary-foreground`）—— 见 tools.css 的双层结构：可见文字由涂层绘制，
 * textarea 只留光标与选区。
 *
 * 令牌值的唯一出处是 `src/theme.css`（Vitest 里 CSS 导入会被置空，所以直接读文件），
 * 这里按 WCAG 相对亮度算对比度，把「明暗两套都得看清」这条不变量钉死在测试里 ——
 * 深色主题曾经只剩浅黄底 + 近白字（高亮那段字看不见），就是要靠这类断言拦住。
 */
const MIN_CONTRAST = 4.5

/** 本文件的上一级目录 = `src/`：令牌读取与 CSS 守卫都相对它定位 */
const SRC_DIR = resolve(import.meta.dirname, '..')

/** 仓库里所有 CSS 路径（src 下递归，含以后新增的文件） */
function allCssFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true })
    .map((entry) => String(entry).replaceAll('\\', '/'))
    .filter((entry) => entry.endsWith('.css'))
}

/**
 * 读 CSS 并剥掉注释：注释里会提到选择器与令牌名（本文件的守卫就是在注释里抄的例子），
 * 不剥掉会同时污染「令牌取值」与「选择器守卫」。
 */
function readCss(relativePath: string): string {
  return readFileSync(resolve(SRC_DIR, relativePath), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

const themeCssText = readCss('theme.css')

/** 浅色基块在前、深色覆盖块（`:root[data-theme='dark']`）在后，据此切分 */
const [lightCssPart, darkCssPart = ''] = themeCssText.split(":root[data-theme='dark']")

/** 取该段文本里第一条规则的属性块（属性块内不嵌套大括号，第一个 `}` 即结束） */
function firstRuleBody(part: string): string {
  const open = part.indexOf('{')
  const close = part.indexOf('}', open)
  if (open < 0 || close < 0) throw new Error('theme.css 的规则体解析失败')
  return part.slice(open + 1, close)
}

/** 属性块里的全部 `--tk-*` 声明 */
function declaredTokens(body: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const [, name, value] of body.matchAll(/(--tk-[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name, value.trim())
  }
  return tokens
}

const lightTokens = declaredTokens(firstRuleBody(lightCssPart))
const darkTokens = declaredTokens(firstRuleBody(darkCssPart))

function tokenValue(theme: 'light' | 'dark', name: string): string {
  const value = (theme === 'dark' ? darkTokens : lightTokens).get(name)
  if (!value) throw new Error(`theme.css 的 ${theme} 主题里找不到 ${name}`)
  return value
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
      // 激活项高亮统一使用 --tk-highlight-foreground（深色字）压在 --tk-highlight（明亮浅黄）上
      const ratio = contrastRatio(
        tokenValue(theme, '--tk-highlight-foreground'),
        tokenValue(theme, '--tk-highlight'),
      )
      expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })

    it(`${theme} 主题：次级高亮（--tk-highlight-secondary）上的文字对比度 ≥ ${MIN_CONTRAST}:1`, () => {
      const ratio = contrastRatio(
        tokenValue(theme, '--tk-highlight-secondary-foreground'),
        tokenValue(theme, '--tk-highlight-secondary'),
      )
      expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })

    it(`${theme} 主题：通用次要背景（--tk-secondary）上的文字对比度 ≥ ${MIN_CONTRAST}:1`, () => {
      expect(textOn(theme, '--tk-secondary')).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })
  }
})

/**
 * 深色令牌有两条送达路径：theme.css 的 `:host([data-theme='dark'])`（Shadow DOM 用）与 theme.ts 的
 * 内联兜底 `THEME_PALETTES`（内联样式优先级最高，实际值以它为准）。任何一条漏掉一个「主题相关令牌」，
 * 该令牌在深色下就会悄悄退回浅色值 —— 高亮标记正是这么漏过一次（`--tk-highlight` 不在兜底里，
 * 于是深色主题拿到浅色主题的浅黄底，压在近白文字上）。
 */
describe('内联兜底完整性（theme.css ↔ theme.ts 调色板）', () => {
  /** 主题相关令牌 = 深色块里改过值的令牌（两套值相同的令牌漏了也无害） */
  const themeDependent = [...darkTokens].filter(([name, value]) => lightTokens.get(name) !== value)

  it('theme.css 里确实有一批主题相关令牌（守卫自身的前提，防它退化成空转）', () => {
    expect(themeDependent.length).toBeGreaterThan(10)
  })

  for (const theme of ['light', 'dark'] as const) {
    it(`${theme} 主题：每个主题相关令牌都被内联到 Shadow DOM 宿主上`, () => {
      stubExtension()
      createHost()

      applyTheme(theme)

      const host = document.getElementById(HOST_ID)
      if (!host) throw new Error('未创建宿主')
      const missing = themeDependent
        .filter(([name]) => cssVar(host, name) === '')
        .map(([name]) => name)
      expect(missing).toEqual([])
    })
  }
})

/** 非函数式 `:host` 只能单独成一个 compound；`:host[attr]` / `:host.cls` 这类写法永远不匹配 */
const BAD_HOST_COMPOUND = /:host(?!\()(?=[.#:[])/

/** 取「选择器列表里恰好含 selector 这条」的规则体（同优先级下最后一条生效，故取最后一条） */
function ruleBody(css: string, selector: string): string {
  const bodies = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter(([, prelude]) =>
      prelude
        .split(',')
        .map((part) => part.trim())
        .includes(selector),
    )
    .map(([, , body]) => body)
  const body = bodies.at(-1)
  if (body === undefined) throw new Error(`找不到 ${selector} 的规则体`)
  return body
}

/**
 * 按 css-scoping，非函数式 `:host` 必须是 compound 里唯一的简单选择器；`:host[data-theme='dark']`
 * 永远不匹配。这类写法如果混进选择器列表，深色令牌在 Shadow DOM 里就整块失效（而扩展页面上是好的，
 * 所以只看页面根本看不出来）—— 曾经就是这么写的，这里把它钉成不可回归的约束。
 */
describe('Shadow DOM 主题选择器', () => {
  it('全仓 CSS 里没有「非函数式 :host + 其它简单选择器」的 compound', () => {
    const offenders: string[] = []
    for (const file of allCssFiles()) {
      readCss(file)
        .split('\n')
        .forEach((line, index) => {
          if (BAD_HOST_COMPOUND.test(line)) offenders.push(`${file}:${index + 1} ${line.trim()}`)
        })
    }
    expect(offenders).toEqual([])
  })

  it("深色令牌块用的正是函数式 :host([data-theme='dark'])", () => {
    expect(themeCssText).toContain(":host([data-theme='dark'])")
  })
})

/**
 * 高亮标记的「文字层契约」只存在于 CSS 里（happy-dom 没有排版引擎，断言不了观感），所以按
 * 声明原文守住结构：可见文字必须由涂层画、textarea 的文字必须透明。反过来写就是那个 bug 的结构 ——
 * 高亮底色由涂层决定，文字色却由 textarea 统一决定，深色下必然撞成浅底浅字。
 */
describe('高亮文字层契约（tools.css）', () => {
  const toolsCssText = readCss('tools/tools.css')

  it('可见文字由涂层绘制，textarea 文字透明、只保留光标', () => {
    expect(ruleBody(toolsCssText, '.tw-area-backdrop')).toMatch(/color:\s*var\(--tk-foreground\)/)
    const input = ruleBody(toolsCssText, '.tw-area-input')
    expect(input).toMatch(/color:\s*transparent/)
    expect(input).toMatch(/caret-color:\s*var\(--tk-foreground\)/)
  })

  it('标记的文字色与底色成对取自高亮令牌，idle 走次级令牌', () => {
    const mark = ruleBody(toolsCssText, '.tw-area-mark')
    expect(mark).toMatch(/color:\s*var\(--tk-highlight-foreground\)/)
    expect(mark).toMatch(/background:\s*var\(--tk-highlight\)/)

    const idle = ruleBody(toolsCssText, '.tw-area-mark--idle')
    expect(idle).toMatch(/color:\s*var\(--tk-highlight-secondary-foreground\)/)
    expect(idle).toMatch(/background:\s*var\(--tk-highlight-secondary\)/)
  })
})
