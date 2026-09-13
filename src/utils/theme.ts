import { useEffect } from 'react'

import { isExtension, storageGet } from '@/utils/env'
import type { ThemeMode } from '@/utils/settings'

/** Content Script Shadow DOM 宿主元素 id */
export const HOST_ID = '__panda_dock_host__'

const SETTINGS_KEY = 'settings'

function isValidTheme(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

/**
 * 主题配色 —— 内联兜底，保证 Shadow DOM 里也换肤。
 *
 * ⚠️ 这是 `src/theme.css` 的一份**副本**，存在的理由只有一个：Shadow DOM 里 `:host(...)` 规则的
 * 级联曾经失效（非函数式 `:host[data-theme='dark']` 永远不匹配），深色令牌会整块落空。内联样式
 * 优先级最高，所以**凡是 theme.css 在深色块里改过值的令牌，这里两个主题都必须各有一份**，否则该
 * 令牌会退回浅色值。历史上漏了 `--pd-highlight`，结果深色主题下浅黄底压着浅色字 —— 看不清。
 * 这条不变量现在由 `theme.dom.test.ts` 的「内联兜底完整性」用例守住，不靠人记。
 */
const THEME_PALETTES: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    '--pd-background': 'hsl(0 0% 99%)',
    '--pd-foreground': 'hsl(240 9% 9%)',
    '--pd-card': 'hsl(0 0% 100%)',
    '--pd-muted': 'hsl(240 5% 96%)',
    '--pd-muted-foreground': 'hsl(240 4% 46%)',
    '--pd-secondary': 'hsl(240 5% 96%)',
    '--pd-secondary-foreground': 'hsl(240 8% 20%)',
    '--pd-accent': 'hsl(240 6% 94%)',
    '--pd-accent-foreground': '#171717',
    '--pd-primary': '#171717',
    '--pd-primary-hover': '#2b2b2b',
    '--pd-primary-active': '#000000',
    '--pd-primary-foreground': '#ffffff',
    '--pd-ring': '#171717',
    '--pd-destructive': 'hsl(0 66% 48%)',
    '--pd-success': 'hsl(149 46% 34%)',
    '--pd-warning': 'hsl(36 78% 38%)',
    '--pd-info': 'hsl(207 70% 42%)',
    '--pd-border': 'hsl(240 6% 90%)',
    '--pd-border-strong': 'hsl(240 5% 82%)',
    '--pd-input': 'hsl(240 6% 90%)',
    '--pd-highlight': '#fef08a',
    '--pd-highlight-foreground': '#171717',
    '--pd-highlight-secondary': '#f3f4f6',
    '--pd-highlight-secondary-foreground': 'hsl(240 9% 9%)',
    '--pd-shadow-xs': '0 1px 1px 0 rgb(24 24 27 / 0.06)',
    '--pd-shadow-sm': '0 1px 2px 0 rgb(24 24 27 / 0.05), 0 1px 3px 0 rgb(24 24 27 / 0.05)',
    '--pd-shadow-md': '0 4px 12px -2px rgb(24 24 27 / 0.08), 0 2px 6px -2px rgb(24 24 27 / 0.05)',
    '--pd-shadow-lg': '0 12px 26px -6px rgb(24 24 27 / 0.18)',
  },
  dark: {
    '--pd-background': 'hsl(240 10% 4%)',
    '--pd-foreground': 'hsl(0 0% 98%)',
    '--pd-card': 'hsl(240 6% 7%)',
    '--pd-muted': 'hsl(240 5% 12%)',
    '--pd-muted-foreground': 'hsl(240 5% 64%)',
    '--pd-secondary': 'hsl(240 4% 12%)',
    '--pd-secondary-foreground': 'hsl(0 0% 98%)',
    '--pd-accent': 'hsl(240 5% 15%)',
    '--pd-accent-foreground': 'hsl(0 0% 98%)',
    '--pd-primary': 'hsl(0 0% 96%)',
    '--pd-primary-hover': 'hsl(0 0% 88%)',
    '--pd-primary-active': 'hsl(0 0% 80%)',
    '--pd-primary-foreground': 'hsl(240 10% 4%)',
    '--pd-ring': 'hsl(0 0% 83%)',
    '--pd-destructive': 'hsl(0 62% 55%)',
    '--pd-success': 'hsl(149 50% 45%)',
    '--pd-warning': 'hsl(36 80% 50%)',
    '--pd-info': 'hsl(207 75% 55%)',
    '--pd-border': 'hsl(240 4% 18%)',
    '--pd-border-strong': 'hsl(240 4% 28%)',
    '--pd-input': 'hsl(240 4% 18%)',
    '--pd-highlight': '#fef08a',
    '--pd-highlight-foreground': '#171717',
    '--pd-highlight-secondary': 'hsl(240 5% 28%)',
    '--pd-highlight-secondary-foreground': 'hsl(0 0% 98%)',
    '--pd-shadow-xs': '0 1px 1px 0 rgb(0 0 0 / 0.3)',
    '--pd-shadow-sm': '0 1px 2px 0 rgb(0 0 0 / 0.4)',
    '--pd-shadow-md': '0 4px 12px -2px rgb(0 0 0 / 0.5)',
    '--pd-shadow-lg': '0 12px 26px -6px rgb(0 0 0 / 0.6)',
  },
}

/** 把主题配色内联设到元素上，作为 Shadow DOM 级联的兜底保证 */
function applyPalette(el: HTMLElement, theme: 'light' | 'dark'): void {
  const palette = THEME_PALETTES[theme]
  for (const [key, value] of Object.entries(palette)) el.style.setProperty(key, value)
}

/** 把主题模式解析成最终生效的 'light' | 'dark'（system 按系统偏好） */
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window === 'undefined') return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

/**
 * 把解析后的主题落到 `data-theme` 属性，并内联补一遍配色：
 * - 扩展页面：设到 documentElement（theme.css 的 :root[data-theme] 命中）
 * - content script：设到 Shadow DOM 宿主（:host[data-theme] 命中），不污染宿主页面根元素。
 *   额外把配色内联到宿主，规避 Shadow DOM 里 `:host[data-theme]` 级联覆盖的坑。
 * - 开发预览（非扩展但存在 content 宿主）：两者都设，让预览页与内容浮层一并跟随。
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const theme = resolveTheme(mode)
  const host = document.getElementById(HOST_ID)
  const setRoot = !host || !isExtension()
  if (host) {
    host.dataset.theme = theme
    applyPalette(host, theme)
  }
  if (setRoot) {
    document.documentElement.dataset.theme = theme
    applyPalette(document.documentElement, theme)
  }
}

/**
 * 读取并应用「主题」设置（chrome.storage.sync 的 settings.theme）。
 * 默认跟随系统；监听系统深浅偏好变化并在 onChanged 时即时切换。
 * 各入口（Popup / Options / 侧边栏 / 悬浮球 / 抽屉）调用后随设置生效。
 */
export function useTheme(): void {
  useEffect(() => {
    // 读取 settings.theme；无 chrome（pnpm dev 预览）时 storageGet 安全返回 null，退化为跟随系统。
    let mode: ThemeMode = 'system'
    let mq: MediaQueryList | null = null
    let onMq: (() => void) | null = null
    const apply = () => applyTheme(mode)

    // 先按系统偏好应用，避免亮色闪烁；读到存档后修正
    apply()

    void storageGet<{ theme?: ThemeMode }>('sync', SETTINGS_KEY).then((s) => {
      if (s?.theme && isValidTheme(s.theme)) {
        mode = s.theme
        apply()
      }
    })

    // 只要有 chrome.storage 就监听变化（content script / 扩展页都满足，不依赖 isExtension 判定）
    const hasChrome = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'sync' || changes[SETTINGS_KEY] == null) return
      const t = (changes[SETTINGS_KEY].newValue as { theme?: ThemeMode } | undefined)?.theme
      if (isValidTheme(t)) {
        mode = t
        apply()
      }
    }
    if (hasChrome) chrome.storage.onChanged.addListener(onChange)

    // 跟随系统：系统深浅偏好变化时重新应用
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
      onMq = () => {
        if (mode === 'system') apply()
      }
      mq.addEventListener('change', onMq)
    } catch {
      mq = null
    }

    return () => {
      if (hasChrome) chrome.storage.onChanged.removeListener(onChange)
      if (mq && onMq) mq.removeEventListener('change', onMq)
    }
  }, [])
}
