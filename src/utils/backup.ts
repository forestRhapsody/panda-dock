import { isExtension, storageGet, storageRemove, storageSet } from '@/utils/env'
import type { Settings } from '@/utils/settings'
import {
  BALL_IMAGE_MAX_DATA_URL_LENGTH,
  BALL_POS_KEY,
  defaultSettings,
  DRAWER_WIDTH_KEY,
  getBallImage,
  normalizeSettings,
  QR_STYLE_PRESET_KEY,
  setBallImage,
} from '@/utils/settings'

export interface PandaDockBackup {
  version: 1
  appName: 'panda-dock'
  exportedAt: string
  settings: Settings
  ballImage?: string | null
}

/**
 * 导出当前完整配置并触发下载 JSON 文件
 */
export async function exportSettingsBackup(currentSettings?: Settings): Promise<void> {
  const inExt = isExtension()
  let settingsToExport = currentSettings
  if (!settingsToExport && inExt) {
    const stored = await storageGet<Partial<Settings>>('sync', 'settings')
    settingsToExport = normalizeSettings(stored)
  }
  if (!settingsToExport) {
    settingsToExport = defaultSettings()
  }

  let ballImage: string | null = null
  if (inExt) {
    ballImage = await getBallImage()
  }

  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const payload: PandaDockBackup = {
    version: 1,
    appName: 'panda-dock',
    exportedAt: now.toISOString(),
    settings: settingsToExport,
    ballImage: ballImage ?? null,
  }

  const jsonStr = JSON.stringify(payload, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const filename = `panda-dock-backup-${dateStr}.json`

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export type ParseBackupResult =
  | {
      ok: true
      settings: Settings
      ballImage: string | null
    }
  | {
      ok: false
      errorKey: string
    }

/**
 * 解析并校验导入的备份文件内容
 */
export function parseAndValidateBackup(jsonText: string): ParseBackupResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, errorKey: 'settings.importInvalidJson' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, errorKey: 'settings.importInvalidFormat' }
  }

  const obj = parsed as Record<string, unknown>

  // 兼容直接导入 settings 对象或标准的 PandaDockBackup 包装对象
  let settingsRaw: unknown = obj.settings
  if (!settingsRaw && ('toolOrder' in obj || 'theme' in obj || 'quickOpen' in obj)) {
    settingsRaw = obj
  }

  if (typeof settingsRaw !== 'object' || settingsRaw === null) {
    return { ok: false, errorKey: 'settings.importInvalidFormat' }
  }

  const normalizedSettings = normalizeSettings(settingsRaw as Partial<Settings>)

  // 检查是否有合法的 ballImage
  let ballImage: string | null = null
  if (typeof obj.ballImage === 'string') {
    if (
      obj.ballImage.startsWith('data:image/') &&
      obj.ballImage.length <= BALL_IMAGE_MAX_DATA_URL_LENGTH
    ) {
      ballImage = obj.ballImage
    }
  }

  return {
    ok: true,
    settings: normalizedSettings,
    ballImage,
  }
}

export type ApplyBackupResult = { ok: true } | { ok: false; reason: 'settings' | 'ballImage' }

/**
 * 将解析好的备份持久化到系统存储（sync 与 local）。
 * 返回失败原因而不是静默吞掉：sync 配额写满时导入会半途失败，必须让用户知道。
 */
export async function applyBackup(backup: {
  settings: Settings
  ballImage: string | null
}): Promise<ApplyBackupResult> {
  if (!isExtension()) return { ok: true }

  const settingsSaved = await storageSet('sync', 'settings', backup.settings)
  if (!settingsSaved) return { ok: false, reason: 'settings' }

  const imageSaved = await setBallImage(backup.ballImage)
  if (!imageSaved.ok) return { ok: false, reason: 'ballImage' }

  // 清理当前设备残留的本地微调状态（悬浮球位置、抽屉宽度、二维码样式偏好），避免旧设备微调影响新配置
  await Promise.all([
    storageRemove('local', BALL_POS_KEY),
    storageRemove('local', DRAWER_WIDTH_KEY),
    storageRemove('local', QR_STYLE_PRESET_KEY),
  ])

  return { ok: true }
}
