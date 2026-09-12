// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { defaultSettings } from '@/utils/settings'

import { exportSettingsBackup, parseAndValidateBackup } from './backup'

/**
 * 导出备份的验收标准是「能被自己读回来」：只断言没抛错无法发现 JSON 结构写错、设置被 storage 旧值覆盖、
 * 或文件名日期与 exportedAt 不一致这类问题。这里把下载全程换成 spy，直接检查 Blob 内容与锚点。
 */

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

interface ChromeStores {
  sync: Record<string, unknown>
  local: Record<string, unknown>
}

/** 内存版 chrome.storage 桩，并按 key 返回数据 */
function stubChrome(initial: Partial<ChromeStores> = {}): ChromeStores {
  const sync: Record<string, unknown> = { ...initial.sync }
  const local: Record<string, unknown> = { ...initial.local }
  const make = (bucket: Record<string, unknown>) => ({
    get: async (key: string) => (key in bucket ? { [key]: bucket[key] } : {}),
    set: async (obj: Record<string, unknown>) => {
      Object.assign(bucket, obj)
    },
    remove: async (key: string) => {
      delete bucket[key]
    },
  })
  globalWithChrome.chrome = {
    runtime: { id: 'test-extension' },
    storage: { sync: make(sync), local: make(local), session: make({}) },
  }
  return { sync, local }
}

interface DownloadCapture {
  createObjectURL: Mock<(obj: Blob | MediaSource) => string>
  revokeObjectURL: Mock<(url: string) => void>
  click: Mock<() => void>
  blob: Blob | null
  filename: string | null
  anchor: HTMLAnchorElement | null
  revoked: string | null
}

function captureDownload(): DownloadCapture {
  const capture: DownloadCapture = {
    createObjectURL: vi.fn<(obj: Blob | MediaSource) => string>(),
    revokeObjectURL: vi.fn<(url: string) => void>(),
    click: vi.fn<() => void>(),
    blob: null,
    filename: null,
    anchor: null,
    revoked: null,
  }

  capture.createObjectURL.mockImplementation((obj) => {
    capture.blob = obj as Blob
    return 'blob:backup-test'
  })
  capture.revokeObjectURL.mockImplementation((url) => {
    capture.revoked = url
  })

  vi.spyOn(URL, 'createObjectURL').mockImplementation(capture.createObjectURL)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(capture.revokeObjectURL)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    capture.anchor = this
    capture.filename = this.download
    capture.click()
  })

  return capture
}

function requireBlob(capture: DownloadCapture): Blob {
  if (!capture.blob) throw new Error('URL.createObjectURL 未被调用，没有导出文件可断言')
  return capture.blob
}

/** 用被测的 parseAndValidateBackup 回读导出的 JSON——导出与导入闭环一致才算通过 */
async function readBack(capture: DownloadCapture) {
  const text = await requireBlob(capture).text()
  const parsed = parseAndValidateBackup(text)
  if (!parsed.ok) throw new Error(`导出的 JSON 无法回读：${parsed.errorKey}`)
  return { raw: JSON.parse(text) as Record<string, unknown>, parsed }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete globalWithChrome.chrome
})

describe('exportSettingsBackup 在扩展环境下', () => {
  it('导出 sync 设置与 local 悬浮球图片，文件名带当天日期且可被回读', async () => {
    stubChrome({
      sync: { settings: { theme: 'dark', quickOpen: false } },
      local: { ballImage: 'data:image/png;base64,iVBORw0KGgo=' },
    })
    const capture = captureDownload()

    await exportSettingsBackup()

    const blob = requireBlob(capture)
    expect(blob.type).toBe('application/json;charset=utf-8')

    const { raw, parsed } = await readBack(capture)
    expect(parsed.settings.theme).toBe('dark')
    expect(parsed.settings.quickOpen).toBe(false)
    expect(parsed.ballImage).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(raw.version).toBe(1)
    expect(raw.appName).toBe('panda-dock')

    // exportedAt 是合法 ISO 时间，文件名日期与它严格一致
    const exportedAt = raw.exportedAt as string
    expect(new Date(exportedAt).toISOString()).toBe(exportedAt)
    expect(capture.filename).toBe(`panda-dock-backup-${exportedAt.slice(0, 10)}.json`)
    expect(capture.filename).toMatch(/^panda-dock-backup-\d{4}-\d{2}-\d{2}\.json$/)

    // 临时锚点必须移除，ObjectURL 必须释放
    expect(capture.anchor?.isConnected).toBe(false)
    expect(document.body.querySelectorAll('a')).toHaveLength(0)
    expect(capture.revoked).toBe('blob:backup-test')
  })

  it('显式传入的 settings 优先于 sync 旧值', async () => {
    stubChrome({ sync: { settings: { theme: 'light', quickOpen: true } } })
    const capture = captureDownload()

    await exportSettingsBackup({ ...defaultSettings(), theme: 'dark', quickOpen: false })

    const { parsed } = await readBack(capture)
    expect(parsed.settings.theme).toBe('dark')
    expect(parsed.settings.quickOpen).toBe(false)
    // 没有自定义悬浮球图片时导出 null
    expect(parsed.ballImage).toBeNull()
  })

  it('sync 里没有 settings 时回退默认设置', async () => {
    stubChrome()
    const capture = captureDownload()

    await exportSettingsBackup()

    const { parsed } = await readBack(capture)
    expect(parsed.settings).toEqual(defaultSettings())
  })
})

describe('exportSettingsBackup 在非扩展环境（无 chrome）', () => {
  it('回退 defaultSettings 且 ballImage 为 null', async () => {
    const capture = captureDownload()

    await exportSettingsBackup()

    const { raw, parsed } = await readBack(capture)
    expect(parsed.settings).toEqual(defaultSettings())
    expect(parsed.ballImage).toBeNull()
    expect(raw.ballImage).toBeNull()
    expect(capture.filename).toMatch(/^panda-dock-backup-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('显式传入 settings 时直接导出该对象', async () => {
    const capture = captureDownload()
    const custom = { ...defaultSettings(), theme: 'dark' as const, fontScale: 1.1 }

    await exportSettingsBackup(custom)

    const { raw } = await readBack(capture)
    expect(raw.settings).toEqual(custom)
  })
})
