import { useEffect } from 'react'

import { isExtension, storageGet } from '@/utils/env'
import type { ThemeMode } from '@/utils/settings'

/** Content Script Shadow DOM 宿主元素 id */
export const HOST_ID = '__toolkit_extension_host__'

const SETTINGS_KEY = 'settings'

function isValidTheme(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** 主题配色（与 src/theme.css 合并一致）—— 供内联兜底，保证 Shadow DOM 里也换肤 */
const THEME_PALETTES: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    '--tk-background': 'hsl(0 0% 99%)',
    '--tk-foreground': 'hsl(240 9% 9%)',
    '--tk-card': 'hsl(0 0% 100%)',
    '--tk-muted': 'hsl(240 5% 96%)',
    '--tk-muted-foreground': 'hsl(240 4% 46%)',
    '--tk-secondary': 'hsl(240 5% 96%)',
    '--tk-secondary-foreground': 'hsl(240 8% 20%)',
    '--tk-accent': 'hsl(240 6% 94%)',
    '--tk-accent-foreground': '#171717',
    '--tk-primary': '#171717',
    '--tk-primary-hover': '#2b2b2b',
    '--tk-primary-active': '#000000',
    '--tk-primary-foreground': '#ffffff',
    '--tk-ring': '#171717',
    '--tk-destructive': 'hsl(0 66% 48%)',
    '--tk-success': 'hsl(149 46% 34%)',
    '--tk-warning': 'hsl(36 78% 38%)',
    '--tk-info': 'hsl(207 70% 42%)',
    '--tk-border': 'hsl(240 6% 90%)',
    '--tk-border-strong': 'hsl(240 5% 82%)',
    '--tk-input': 'hsl(240 6% 90%)',
    '--tk-shadow-sm': '0 1px 2px 0 rgb(24 24 27 / 0.05), 0 1px 3px 0 rgb(24 24 27 / 0.05)',
    '--tk-shadow-md': '0 4px 12px -2px rgb(24 24 27 / 0.08), 0 2px 6px -2px rgb(24 24 27 / 0.05)',
    '--tk-shadow-lg': '0 12px 26px -6px rgb(24 24 27 / 0.18)',
  },
  dark: {
    '--tk-background': 'hsl(240 10% 4%)',
    '--tk-foreground': 'hsl(0 0% 98%)',
    '--tk-card': 'hsl(240 6% 7%)',
    '--tk-muted': 'hsl(240 5% 12%)',
    '--tk-muted-foreground': 'hsl(240 5% 64%)',
    '--tk-secondary': 'hsl(240 4% 12%)',
    '--tk-secondary-foreground': 'hsl(0 0% 98%)',
    '--tk-accent': 'hsl(240 5% 15%)',
    '--tk-accent-foreground': 'hsl(0 0% 98%)',
    '--tk-primary': 'hsl(0 0% 96%)',
    '--tk-primary-hover': 'hsl(0 0% 88%)',
    '--tk-primary-active': 'hsl(0 0% 80%)',
    '--tk-primary-foreground': 'hsl(240 10% 4%)',
    '--tk-ring': 'hsl(0 0% 83%)',
    '--tk-destructive': 'hsl(0 62% 55%)',
    '--tk-success': 'hsl(149 50% 45%)',
    '--tk-warning': 'hsl(36 80% 50%)',
    '--tk-info': 'hsl(207 75% 55%)',
    '--tk-border': 'hsl(240 4% 18%)',
    '--tk-border-strong': 'hsl(240 4% 28%)',
    '--tk-input': 'hsl(240 4% 18%)',
    '--tk-shadow-sm': '0 1px 2px 0 rgb(0 0 0 / 0.4)',
    '--tk-shadow-md': '0 4px 12px -2px rgb(0 0 0 / 0.5)',
    '--tk-shadow-lg': '0 12px 26px -6px rgb(0 0 0 / 0.6)',
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
