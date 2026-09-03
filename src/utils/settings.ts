/** 扩展全局设置：`chrome.storage.sync` 的 `settings` 字段的类型、默认值与规范化。
 *  Popup / Options 共用同一份读写与兜底逻辑，保证两处同步不跑偏。 */

import type { ToolId } from '@/tools/registry'
import { defaultToolLayout, normalizeToolLayout } from '@/tools/registry'
import type { BallAction } from '@/utils/messages'

/** 主题模式：浅色 / 深色 / 跟随系统 */
export type ThemeMode = 'light' | 'dark' | 'system'

/** 允许的主题档位 */
export const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
]

/** 语言设置：中文 / English / 跟随系统 */
export type LocaleSetting = 'zh' | 'en' | 'system'

/** 允许的语言档位 */
export const LOCALE_OPTIONS: { label: string; value: LocaleSetting }[] = [
  { label: '跟随系统', value: 'system' },
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
]

/** 允许的字体缩放档位 */
export const FONT_SCALE_OPTIONS: { label: string; value: number }[] = [
  { label: '标准', value: 1 },
  { label: '较大', value: 1.1 },
  { label: '最大', value: 1.25 },
]

export interface Settings {
  /** 是否在网页上显示悬浮球 */
  quickOpen: boolean
  /** 悬浮球是否吸边（true=贴靠左右；false=可自由停留） */
  ballSnap: boolean
  /** 点击悬浮球的动作：网页内抽屉 / 浏览器原生侧边栏 */
  ballAction: BallAction
  /** 主题模式：浅色 / 深色 / 跟随系统 */
  theme: ThemeMode
  /** 语言：中文 / English / 跟随系统 */
  locale: LocaleSetting
  /** 整体字体缩放（1 / 1.1 / 1.25） */
  fontScale: number
  /** 工具顺序（含隐藏项），对应 registry 全量 */
  toolOrder: ToolId[]
  /** 工具显隐 */
  toolEnabled: Record<string, boolean>
}

function normalizeFontScale(value: unknown): number {
  return FONT_SCALE_OPTIONS.some((o) => o.value === value) ? (value as number) : 1
}

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function normalizeLocale(value: unknown): LocaleSetting {
  return value === 'zh' || value === 'en' || value === 'system' ? value : 'system'
}

export function defaultSettings(): Settings {
  const layout = defaultToolLayout()
  return {
    quickOpen: true,
    ballSnap: true,
    ballAction: 'drawer',
    theme: 'system',
    locale: 'system',
    fontScale: 1,
    toolOrder: layout.order,
    toolEnabled: layout.enabled,
  }
}

/** 把 storage 里的旧数据/残缺数据兜底成完整 Settings */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const base = defaultSettings()
  const layout = normalizeToolLayout(raw?.toolOrder, raw?.toolEnabled)
  return {
    quickOpen: raw?.quickOpen ?? base.quickOpen,
    ballSnap: raw?.ballSnap !== false,
    ballAction: raw?.ballAction === 'native' ? 'native' : base.ballAction,
    theme: normalizeTheme(raw?.theme),
    locale: normalizeLocale(raw?.locale),
    fontScale: normalizeFontScale(raw?.fontScale),
    toolOrder: layout.order,
    toolEnabled: layout.enabled,
  }
}
