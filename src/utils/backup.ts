import { isExtension, storageGet, storageSet } from '@/utils/env'
import type { Settings } from '@/utils/settings'
import {
  BALL_IMAGE_MAX_DATA_URL_LENGTH,
  defaultSettings,
  getBallImage,
  normalizeSettings,
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

/**
 * 将解析好的备份持久化到系统存储（sync 与 local）
 */
export async function applyBackup(backup: {
  settings: Settings
  ballImage: string | null
}): Promise<void> {
  const inExt = isExtension()
  if (inExt) {
    await storageSet('sync', 'settings', backup.settings)
    await setBallImage(backup.ballImage)
  }
}
