import { afterEach, describe, expect, it } from 'vitest'

import { BALL_IMAGE_MAX_DATA_URL_LENGTH, defaultSettings } from '@/utils/settings'

import { applyBackup, parseAndValidateBackup } from './backup'

/**
 * 导入备份是「不可信输入」入口：备份文件可能来自旧版本、被手工编辑过、甚至根本不是本扩展的导出。
 * 这里覆盖两条命脉——`parseAndValidateBackup` 必须只接受结构化设置并丢弃伪造的 version/exportedAt，
 * `applyBackup` 必须把 sync 配额写满、悬浮球图片写失败这类半途失败显式回报，而不是假装成功。
 */

const VALID_BALL_IMAGE = 'data:image/png;base64,iVBORw0KGgo='
const BALL_IMAGE_PREFIX = 'data:image/png;base64,'

/** 用 unknown 断开与 @types/chrome 的强类型绑定：这里只需要一个「可控失败」的桩 */
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

function stubChrome(
  impl: {
    syncSet?: (obj: Record<string, unknown>) => Promise<void>
    localSet?: (obj: Record<string, unknown>) => Promise<void>
  } = {},
) {
  const sync = {
    get: async () => ({}),
    set: impl.syncSet ?? (async () => {}),
    remove: async () => {},
  }
  const local = {
    get: async () => ({}),
    set: impl.localSet ?? (async () => {}),
    remove: async () => {},
  }
  globalWithChrome.chrome = {
    runtime: { id: 'test-extension' },
    storage: { sync, local, session: sync },
  }
}

/** 构造标准 PandaDockBackup 包装对象 */
function backupJson(overrides: Record<string, unknown> = {}): string {
  const base = defaultSettings()
  return JSON.stringify({
    version: 1,
    appName: 'panda-dock',
    exportedAt: '2024-05-06T07:08:09.000Z',
    settings: {
      theme: 'dark',
      quickOpen: false,
      toolOrder: base.toolOrder,
      toolEnabled: base.toolEnabled,
    },
    ballImage: VALID_BALL_IMAGE,
    ...overrides,
  })
}

/** 解包 ok 结果；失败时把 errorKey 带进断言信息，便于定位 */
function unwrap(result: ReturnType<typeof parseAndValidateBackup>) {
  if (!result.ok) throw new Error(`期望解析成功，实际失败：${result.errorKey}`)
  return result
}

afterEach(() => {
  delete globalWithChrome.chrome
})

describe('parseAndValidateBackup 的输入校验', () => {
  it('合法完整备份能解析出设置与悬浮球图片', () => {
    const result = unwrap(parseAndValidateBackup(backupJson()))

    expect(result.settings.theme).toBe('dark')
    expect(result.settings.quickOpen).toBe(false)
    expect(result.settings.toolOrder).toEqual(defaultSettings().toolOrder)
    expect(result.ballImage).toBe(VALID_BALL_IMAGE)
  })

  it('非法 JSON（含空串）报 importInvalidJson', () => {
    expect(parseAndValidateBackup('{ not json')).toEqual({
      ok: false,
      errorKey: 'settings.importInvalidJson',
    })
    expect(parseAndValidateBackup('')).toEqual({
      ok: false,
      errorKey: 'settings.importInvalidJson',
    })
  })

  it.each(['null', '123', '"text"', 'true', '[]', 'false'])(
    '%s 不是备份对象，报 importInvalidFormat',
    (raw) => {
      expect(parseAndValidateBackup(raw)).toEqual({
        ok: false,
        errorKey: 'settings.importInvalidFormat',
      })
    },
  )

  it('settings 非对象时不接受（字符串 / 数字）', () => {
    for (const payload of [{ settings: 'nope' }, { settings: 42 }, {}]) {
      expect(parseAndValidateBackup(JSON.stringify(payload))).toEqual({
        ok: false,
        errorKey: 'settings.importInvalidFormat',
      })
    }
  })

  it('没有 settings 包裹但含裸设置字段时按裸设置对象接受', () => {
    const byTheme = unwrap(parseAndValidateBackup(JSON.stringify({ theme: 'light' })))
    expect(byTheme.settings.theme).toBe('light')
    expect(byTheme.ballImage).toBeNull()

    const byQuickOpen = unwrap(parseAndValidateBackup(JSON.stringify({ quickOpen: false })))
    expect(byQuickOpen.settings.quickOpen).toBe(false)

    const byToolOrder = unwrap(
      parseAndValidateBackup(JSON.stringify({ toolOrder: defaultSettings().toolOrder })),
    )
    expect(byToolOrder.settings.toolOrder).toEqual(defaultSettings().toolOrder)
  })

  it('裸对象没有任何可识别字段时仍报 importInvalidFormat', () => {
    expect(parseAndValidateBackup(JSON.stringify({ foo: 1 }))).toEqual({
      ok: false,
      errorKey: 'settings.importInvalidFormat',
    })
  })

  it('version / appName / exportedAt 不被信任：不进入结果，设置按内容归一化并补默认值', () => {
    const result = unwrap(
      parseAndValidateBackup(
        backupJson({
          version: 999,
          appName: 'evil',
          exportedAt: 'not-a-date',
          settings: { theme: 'dark' },
        }),
      ),
    )

    // 结果只有约定的三个字段，伪造的元数据不会外泄
    expect(Object.keys(result).sort()).toEqual(['ballImage', 'ok', 'settings'])
    expect(result.settings.theme).toBe('dark')
    expect(result.settings.fontScale).toBe(1)
    expect(result.settings.locale).toBe('system')
    expect(result.settings.ballSize).toBe('sm')
  })
})

describe('parseAndValidateBackup 对 ballImage 的边界校验', () => {
  function parseWithBallImage(ballImage: unknown) {
    return unwrap(
      parseAndValidateBackup(JSON.stringify({ settings: { theme: 'dark' }, ballImage })),
    )
  }

  it('合法 data:image/ URL 被接受', () => {
    expect(parseWithBallImage(VALID_BALL_IMAGE).ballImage).toBe(VALID_BALL_IMAGE)
  })

  it('长度刚好等于上限时接受', () => {
    const exact =
      BALL_IMAGE_PREFIX + 'A'.repeat(BALL_IMAGE_MAX_DATA_URL_LENGTH - BALL_IMAGE_PREFIX.length)
    expect(exact.length).toBe(BALL_IMAGE_MAX_DATA_URL_LENGTH)

    expect(parseWithBallImage(exact).ballImage).toBe(exact)
  })

  it('超过上限一个字符就丢弃', () => {
    const over =
      BALL_IMAGE_PREFIX + 'A'.repeat(BALL_IMAGE_MAX_DATA_URL_LENGTH - BALL_IMAGE_PREFIX.length + 1)
    const result = parseWithBallImage(over)

    expect(result.ok).toBe(true)
    expect(result.ballImage).toBeNull()
  })

  it.each([
    ['http 链接', 'https://example.com/ball.png'],
    ['非 image 的 data URL', 'data:application/pdf;base64,AAAA'],
    ['text 类型 data URL', 'data:text/plain;base64,AAAA'],
    ['空字符串', ''],
    ['数字', 123],
    ['null', null],
    ['对象', { src: VALID_BALL_IMAGE }],
    ['数组', [VALID_BALL_IMAGE]],
  ])('非法的 ballImage（%s）被丢弃但备份本身仍然可用', (_name, ballImage) => {
    const result = parseWithBallImage(ballImage)

    expect(result.ok).toBe(true)
    expect(result.ballImage).toBeNull()
    expect(result.settings.theme).toBe('dark')
  })
})

describe('applyBackup 的持久化与失败原因', () => {
  it('非扩展环境（无 chrome）直接返回 ok', async () => {
    await expect(applyBackup({ settings: defaultSettings(), ballImage: null })).resolves.toEqual({
      ok: true,
    })
  })

  it('sync 写入失败（配额已满）返回 reason: settings', async () => {
    stubChrome({
      syncSet: async () => {
        throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded')
      },
    })

    await expect(applyBackup({ settings: defaultSettings(), ballImage: null })).resolves.toEqual({
      ok: false,
      reason: 'settings',
    })
  })

  it('悬浮球图片写 local 失败返回 reason: ballImage', async () => {
    stubChrome({
      localSet: async () => {
        throw new Error('local write failed')
      },
    })

    await expect(
      applyBackup({ settings: defaultSettings(), ballImage: VALID_BALL_IMAGE }),
    ).resolves.toEqual({ ok: false, reason: 'ballImage' })
  })

  it('图片超过体积上限也归为 reason: ballImage', async () => {
    stubChrome()
    const oversized = BALL_IMAGE_PREFIX + 'A'.repeat(BALL_IMAGE_MAX_DATA_URL_LENGTH)

    await expect(
      applyBackup({ settings: defaultSettings(), ballImage: oversized }),
    ).resolves.toEqual({ ok: false, reason: 'ballImage' })
  })

  it('全部成功时设置落到 sync、图片落到 local', async () => {
    const written: { sync: Record<string, unknown>[]; local: Record<string, unknown>[] } = {
      sync: [],
      local: [],
    }
    stubChrome({
      syncSet: async (obj) => {
        written.sync.push(obj)
      },
      localSet: async (obj) => {
        written.local.push(obj)
      },
    })

    const settings = { ...defaultSettings(), theme: 'dark' as const }

    await expect(applyBackup({ settings, ballImage: VALID_BALL_IMAGE })).resolves.toEqual({
      ok: true,
    })
    expect(written.sync).toEqual([{ settings }])
    expect(written.local).toEqual([{ ballImage: VALID_BALL_IMAGE }])
  })
})
