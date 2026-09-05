/** 扩展全局设置：`chrome.storage.sync` 的 `settings` 字段的类型、默认值与规范化。
 *  Popup / Options 共用同一份读写与兜底逻辑，保证两处同步不跑偏。 */

import type { ToolId } from '@/tools/registry'
import { defaultToolLayout, normalizeToolLayout } from '@/tools/registry'
import { storageGet, storageSet } from '@/utils/env'
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

export type DomainMatchMode = 'blacklist' | 'whitelist'

/** 悬浮球形状：圆形 / 带圆角方形 */
export type BallShape = 'circle' | 'rounded'

/** 悬浮球预设样式（无自定义图片时的外观）：主题色实心 / 描边 / 柔和 */
export type BallPreset = 'primary' | 'outline' | 'soft'

/** 悬浮球大小档位：小 / 中 / 大 */
export type BallSize = 'sm' | 'md' | 'lg'

export const BALL_SHAPE_OPTIONS: { labelKey: string; value: BallShape }[] = [
  { labelKey: 'settings.ballShapeCircle', value: 'circle' },
  { labelKey: 'settings.ballShapeRounded', value: 'rounded' },
]

export const BALL_PRESET_OPTIONS: {
  labelKey: string
  value: BallPreset
  icon: string
  /** 若为图片 logo，则为相对 public 的路径（如 ball-default.png），否则用 emoji icon 占位 */
  image?: string
}[] = [
  {
    labelKey: 'settings.ballPresetPrimary',
    value: 'primary',
    icon: '🔵',
    image: 'ball-default.png',
  },
  { labelKey: 'settings.ballPresetOutline', value: 'outline', icon: '⚪' },
  { labelKey: 'settings.ballPresetSoft', value: 'soft', icon: '🌸' },
]

export const BALL_SIZE_OPTIONS: { labelKey: string; value: BallSize }[] = [
  { labelKey: 'settings.ballSizeSm', value: 'sm' },
  { labelKey: 'settings.ballSizeMd', value: 'md' },
  { labelKey: 'settings.ballSizeLg', value: 'lg' },
]

/** 各档位的悬浮球直径（px） */
export const BALL_SIZE_PX: Record<BallSize, number> = { sm: 36, md: 44, lg: 56 }

/** 解析悬浮球 logo 图片的运行时 URL（扩展环境 chrome.runtime.getURL，其余回退 /path） */
export function ballAssetUrl(path: string): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(path)
    }
  } catch {
    // 忽略，回退
  }
  return `/${path}`
}

/** 自定义悬浮球图片（base64 data URL）存于 chrome.storage.local 的 key */
export const BALL_IMAGE_KEY = 'ballImage'

/** 自定义图片 base64 data URL 的最大长度（128KB），超出拒绝 */
export const BALL_IMAGE_MAX_BYTES = 128 * 1024

function normalizeBallShape(value: unknown): BallShape {
  return value === 'rounded' ? 'rounded' : 'circle'
}

function normalizeBallPreset(value: unknown): BallPreset {
  return value === 'outline' || value === 'soft' ? value : 'primary'
}

function normalizeBallSize(value: unknown): BallSize {
  return value === 'sm' || value === 'lg' ? value : 'md'
}

/** 读取自定义悬浮球图片（base64 data URL），不存在返回 null */
export async function getBallImage(): Promise<string | null> {
  return storageGet<string>('local', BALL_IMAGE_KEY)
}

/** 保存（或置空）自定义悬浮球图片。dataUrl 超过 128KB 抛错；传 null 清除。 */
export async function setBallImage(dataUrl: string | null): Promise<void> {
  if (dataUrl && dataUrl.length > BALL_IMAGE_MAX_BYTES) {
    throw new Error('图片过大，base64 后不能超过 128KB')
  }
  await storageSet('local', BALL_IMAGE_KEY, dataUrl)
}

export interface Settings {
  /** 是否在网页上显示悬浮球 */
  quickOpen: boolean
  /** 悬浮球是否吸边（true=贴靠左右；false=可自由停留） */
  ballSnap: boolean
  /** 悬浮球形状：圆形 / 带圆角方形 */
  ballShape: BallShape
  /** 悬浮球预设样式（无自定义图片时） */
  ballPreset: BallPreset
  /** 悬浮球大小档位 */
  ballSize: BallSize
  /** 点击悬浮球的动作：网页内抽屉 / 浏览器原生侧边栏 */
  ballAction: BallAction
  /** 域名过滤模式：黑名单模式（默认）/ 白名单模式 */
  ballDomainMode: DomainMatchMode
  /** 悬浮球黑名单域名规则列表 */
  ballBlacklist: string[]
  /** 悬浮球白名单域名规则列表 */
  ballWhitelist: string[]
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

function normalizeDomainMode(value: unknown): DomainMatchMode {
  return value === 'whitelist' ? 'whitelist' : 'blacklist'
}

function normalizeDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const set = new Set<string>()
  for (const item of value) {
    if (typeof item === 'string') {
      const trimmed = item.trim().toLowerCase()
      if (trimmed) set.add(trimmed)
    }
  }
  return Array.from(set)
}

export function defaultSettings(): Settings {
  const layout = defaultToolLayout()
  return {
    quickOpen: true,
    ballSnap: true,
    ballShape: 'circle',
    ballPreset: 'primary',
    ballSize: 'md',
    ballAction: 'drawer',
    ballDomainMode: 'blacklist',
    ballBlacklist: [],
    ballWhitelist: [],
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
    ballShape: normalizeBallShape(raw?.ballShape),
    ballPreset: normalizeBallPreset(raw?.ballPreset),
    ballSize: normalizeBallSize(raw?.ballSize),
    ballAction: raw?.ballAction === 'native' ? 'native' : base.ballAction,
    ballDomainMode: normalizeDomainMode(raw?.ballDomainMode),
    ballBlacklist: normalizeDomainList(raw?.ballBlacklist),
    ballWhitelist: normalizeDomainList(raw?.ballWhitelist),
    theme: normalizeTheme(raw?.theme),
    locale: normalizeLocale(raw?.locale),
    fontScale: normalizeFontScale(raw?.fontScale),
    toolOrder: layout.order,
    toolEnabled: layout.enabled,
  }
}
