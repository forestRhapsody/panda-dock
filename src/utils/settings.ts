/** 扩展全局设置：`chrome.storage.sync` 的 `settings` 字段的类型、默认值与规范化。
 *  Popup / Options 共用同一份读写与兜底逻辑，保证两处同步不跑偏。 */

import type { ToolId } from '@/tools/registry'
import { defaultToolLayout, normalizeToolLayout } from '@/tools/registry'
import { storageGet, storageRemove, storageSet } from '@/utils/env'
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

/** 悬浮球停靠行为：自动吸边 / 自由停靠 / 固定右下角 */
export type BallDockMode = 'edge' | 'free' | 'bottomRight'

export const BALL_DOCK_MODE_OPTIONS: { labelKey: string; value: BallDockMode }[] = [
  { labelKey: 'settings.ballDockModeEdge', value: 'edge' },
  { labelKey: 'settings.ballDockModeFree', value: 'free' },
  { labelKey: 'settings.ballDockModeBottomRight', value: 'bottomRight' },
]

/** 固定右下角模式的默认边距（px） */
export const DEFAULT_BOTTOM_RIGHT_OFFSET_X = 80
export const DEFAULT_BOTTOM_RIGHT_OFFSET_Y = 80

/** 悬浮球形状：圆形 / 圆角矩形 / 矩形 */
export type BallShape = 'circle' | 'rounded' | 'square'

/** 悬浮球预设样式（无自定义图片时的外观）：主题色实心 / 描边 */
export type BallPreset = 'primary' | 'outline'

/** 悬浮球大小档位：小 / 中 / 大 */
export type BallSize = 'sm' | 'md' | 'lg'

export const BALL_SHAPE_OPTIONS: { labelKey: string; value: BallShape }[] = [
  { labelKey: 'settings.ballShapeCircle', value: 'circle' },
  { labelKey: 'settings.ballShapeRounded', value: 'rounded' },
  { labelKey: 'settings.ballShapeSquare', value: 'square' },
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
  {
    labelKey: 'settings.ballPresetOutline',
    value: 'outline',
    icon: '⚪',
    image: 'ball-preset-outline.png',
  },
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

/** 悬浮球记忆坐标存于 chrome.storage.local 的 key */
export const BALL_POS_KEY = 'panda.ballPos'

/** 网页抽屉宽度存于 chrome.storage.local 的 key */
export const DRAWER_WIDTH_KEY = 'panda.drawerWidth'

/** 二维码默认样式预设存于 chrome.storage.local 的 key */
export const QR_STYLE_PRESET_KEY = 'panda.qrcode.stylePreset'

/**
 * 清除保存在 chrome.storage.local 中的全部偏好与交互状态
 * （悬浮球自定义图片、悬浮球记忆位置、网页抽屉宽度、二维码默认样式预设）。
 */
export async function clearAllLocalPreferences(): Promise<void> {
  await Promise.all([
    storageRemove('local', BALL_IMAGE_KEY),
    storageRemove('local', BALL_POS_KEY),
    storageRemove('local', DRAWER_WIDTH_KEY),
    storageRemove('local', QR_STYLE_PRESET_KEY),
  ])
}

/** 自定义悬浮球图片文件大小上限（128KB），超出拒绝 */
export const BALL_IMAGE_MAX_BYTES = 128 * 1024

/** base64 data URL 最大允许字符长度（对应 128KB 二进制原始文件编码后体积约 175KB + 头部冗余） */
export const BALL_IMAGE_MAX_DATA_URL_LENGTH = Math.ceil((BALL_IMAGE_MAX_BYTES * 4) / 3) + 512

function normalizeBallShape(value: unknown): BallShape {
  return value === 'rounded' || value === 'square' ? value : 'circle'
}

function normalizeBallPreset(value: unknown): BallPreset {
  return value === 'outline' ? value : 'primary'
}

function normalizeBallSize(value: unknown): BallSize {
  return value === 'md' || value === 'lg' ? value : 'sm'
}

/** 读取自定义悬浮球图片（base64 data URL），不存在返回 null */
export async function getBallImage(): Promise<string | null> {
  return storageGet<string>('local', BALL_IMAGE_KEY)
}

export type BallImageSaveResult = { ok: true } | { ok: false; reason: 'too-large' | 'write-failed' }

/**
 * 保存（或置空）自定义悬浮球图片。传 null 清除。
 * 不再抛异常：体积超限与写入失败都通过返回值表达，由调用方翻成当前语言的提示
 * （避免在纯逻辑模块里硬编码文案，也避免调用方 `void setBallImage(...)` 吞掉异常）。
 */
export async function setBallImage(dataUrl: string | null): Promise<BallImageSaveResult> {
  if (dataUrl && dataUrl.length > BALL_IMAGE_MAX_DATA_URL_LENGTH) {
    return { ok: false, reason: 'too-large' }
  }
  const saved = await storageSet('local', BALL_IMAGE_KEY, dataUrl)
  return saved ? { ok: true } : { ok: false, reason: 'write-failed' }
}

/**
 * 保存设置到 `chrome.storage.sync`，返回是否写入成功。
 * `chrome.storage.sync` 有单条 8KB 与写入频率配额，失败是**静默**的
 * （storageSet 只返回布尔值），所以调用方必须检查返回值并提示用户，
 * 否则用户会以为设置已经保存。
 */
export async function saveSettings(settings: Settings): Promise<boolean> {
  return storageSet('sync', 'settings', settings)
}

export interface Settings {
  /** 是否在网页上显示悬浮球 */
  quickOpen: boolean
  /** 悬浮球是否吸边（true=贴靠左右；false=可自由停留）——向后兼容保留，与 ballDockMode 同步 */
  ballSnap: boolean
  /** 悬浮球停靠与吸附行为：自动吸边 / 自由停靠 / 固定右下角 */
  ballDockMode: BallDockMode
  /** 固定右下角模式：右侧边距（px，默认 80，见 DEFAULT_BOTTOM_RIGHT_OFFSET_X） */
  ballBottomRightRight: number
  /** 固定右下角模式：底部边距（px，默认 80，见 DEFAULT_BOTTOM_RIGHT_OFFSET_Y） */
  ballBottomRightBottom: number
  /** 悬浮球形状：圆形 / 圆角方形 / 矩形 */
  ballShape: BallShape
  /** 悬浮球预设样式（无自定义图片时） */
  ballPreset: BallPreset
  /** 悬浮球大小档位 */
  ballSize: BallSize
  /** 默认唤起方式：网页内抽屉 / 浏览器原生侧边栏 */
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

function normalizeBallDockMode(value: unknown, fallbackSnap?: unknown): BallDockMode {
  if (value === 'edge' || value === 'free' || value === 'bottomRight') {
    return value
  }
  if (fallbackSnap === false) {
    return 'free'
  }
  return 'edge'
}

function normalizeOffset(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return Math.max(0, Math.min(Math.round(value), 800))
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10)
    if (!Number.isNaN(parsed)) {
      return Math.max(0, Math.min(parsed, 800))
    }
  }
  return fallback
}

export function defaultSettings(): Settings {
  const layout = defaultToolLayout()
  return {
    quickOpen: true,
    ballSnap: true,
    ballDockMode: 'edge',
    ballBottomRightRight: DEFAULT_BOTTOM_RIGHT_OFFSET_X,
    ballBottomRightBottom: DEFAULT_BOTTOM_RIGHT_OFFSET_Y,
    ballShape: 'circle',
    ballPreset: 'primary',
    ballSize: 'sm',
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
  const ballDockMode = normalizeBallDockMode(raw?.ballDockMode, raw?.ballSnap)
  return {
    quickOpen: raw?.quickOpen ?? base.quickOpen,
    ballSnap: ballDockMode === 'edge',
    ballDockMode,
    ballBottomRightRight: normalizeOffset(raw?.ballBottomRightRight, base.ballBottomRightRight),
    ballBottomRightBottom: normalizeOffset(raw?.ballBottomRightBottom, base.ballBottomRightBottom),
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
