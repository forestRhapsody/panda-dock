/** 扩展全局设置：`chrome.storage.sync` 的 `settings` 字段的类型、默认值与规范化。
 *  Popup / Options 共用同一份读写与兜底逻辑，保证两处同步不跑偏。 */

import type { ToolId } from '@/tools/registry'
import { defaultToolLayout, normalizeToolLayout } from '@/tools/registry'
import type { BallAction } from '@/utils/messages'

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

export function defaultSettings(): Settings {
  const layout = defaultToolLayout()
  return {
    quickOpen: true,
    ballSnap: true,
    ballAction: 'drawer',
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
    fontScale: normalizeFontScale(raw?.fontScale),
    toolOrder: layout.order,
    toolEnabled: layout.enabled,
  }
}
