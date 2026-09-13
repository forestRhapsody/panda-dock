import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_TOOLS,
  defaultToolLayout,
  isToolId,
  normalizeToolLayout,
  visibleTools,
} from '@/tools/registry'
import {
  BALL_IMAGE_KEY,
  BALL_IMAGE_MAX_BYTES,
  BALL_IMAGE_MAX_DATA_URL_LENGTH,
  ballAssetUrl,
  DEFAULT_BOTTOM_RIGHT_OFFSET_X,
  DEFAULT_BOTTOM_RIGHT_OFFSET_Y,
  defaultSettings,
  FONT_SCALE_OPTIONS,
  getBallImage,
  LOCALE_OPTIONS,
  normalizeSettings,
  saveSettings,
  setBallImage,
  THEME_OPTIONS,
} from '@/utils/settings'

describe('defaultSettings / normalizeSettings', () => {
  it('空数据兜底为完整默认值', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings())
    expect(normalizeSettings(undefined)).toEqual(defaultSettings())
    expect(normalizeSettings({})).toEqual(defaultSettings())
  })

  it('每次调用返回互不共享的数组 / 对象', () => {
    const a = defaultSettings()
    const b = defaultSettings()
    expect(a.toolOrder).not.toBe(b.toolOrder)
    expect(a.toolEnabled).not.toBe(b.toolEnabled)
  })

  it('显式 false 被保留，缺省时回退默认', () => {
    expect(normalizeSettings({ quickOpen: false }).quickOpen).toBe(false)
    expect(normalizeSettings({}).quickOpen).toBe(true)
    expect(normalizeSettings({ ballSnap: false }).ballSnap).toBe(false)
    expect(normalizeSettings({ ballSnap: true }).ballSnap).toBe(true)
  })

  it('悬浮球形状 / 预设 / 大小非法值回退', () => {
    expect(normalizeSettings({ ballShape: 'circle' }).ballShape).toBe('circle')
    expect(normalizeSettings({ ballShape: 'rounded' }).ballShape).toBe('rounded')
    expect(normalizeSettings({ ballShape: 'square' }).ballShape).toBe('square')
    expect(normalizeSettings({ ballShape: '三角' as never }).ballShape).toBe('circle')
    expect(normalizeSettings({ ballPreset: 'soft' }).ballPreset).toBe('soft')
    expect(normalizeSettings({ ballPreset: 'nope' as never }).ballPreset).toBe('primary')
    expect(normalizeSettings({ ballSize: 'lg' }).ballSize).toBe('lg')
    expect(normalizeSettings({ ballSize: 'xl' as never }).ballSize).toBe('sm')
  })

  it('悬浮球停靠行为及旧 ballSnap 字段兼容', () => {
    expect(normalizeSettings({ ballDockMode: 'edge' }).ballDockMode).toBe('edge')
    expect(normalizeSettings({ ballDockMode: 'free' }).ballDockMode).toBe('free')
    expect(normalizeSettings({ ballDockMode: 'bottomRight' }).ballDockMode).toBe('bottomRight')
    expect(normalizeSettings({ ballDockMode: 'invalid' as never }).ballDockMode).toBe('edge')

    // 兼容旧数据：旧 ballSnap: false 迁移为 free
    const legacyFree = normalizeSettings({ ballSnap: false })
    expect(legacyFree.ballDockMode).toBe('free')
    expect(legacyFree.ballSnap).toBe(false)

    // 兼容旧数据：旧 ballSnap: true 迁移为 edge
    const legacyEdge = normalizeSettings({ ballSnap: true })
    expect(legacyEdge.ballDockMode).toBe('edge')
    expect(legacyEdge.ballSnap).toBe(true)

    // ballDockMode 优先于旧 ballSnap
    const override = normalizeSettings({ ballDockMode: 'bottomRight', ballSnap: false })
    expect(override.ballDockMode).toBe('bottomRight')
    expect(override.ballSnap).toBe(false)
  })

  it('固定右下角边距规范化及非法值回退', () => {
    expect(normalizeSettings({ ballBottomRightRight: 80 }).ballBottomRightRight).toBe(80)
    expect(normalizeSettings({ ballBottomRightBottom: 100 }).ballBottomRightBottom).toBe(100)
    // 字符串数字解析
    expect(normalizeSettings({ ballBottomRightRight: '120' as never }).ballBottomRightRight).toBe(
      120,
    )
    // 范围限制 0 ~ 800
    expect(normalizeSettings({ ballBottomRightRight: -10 }).ballBottomRightRight).toBe(0)
    expect(normalizeSettings({ ballBottomRightBottom: 1000 }).ballBottomRightBottom).toBe(800)
    // 非法值回退到默认 80
    expect(
      normalizeSettings({ ballBottomRightRight: 'invalid' as never }).ballBottomRightRight,
    ).toBe(80)
    expect(normalizeSettings({ ballBottomRightBottom: null as never }).ballBottomRightBottom).toBe(
      80,
    )
  })

  it('点击行为 / 主题 / 语言 / 字号 / 域名模式非法值回退', () => {
    expect(normalizeSettings({ ballAction: 'native' }).ballAction).toBe('native')
    expect(normalizeSettings({ ballAction: 'x' as never }).ballAction).toBe('drawer')
    expect(normalizeSettings({ theme: 'dark' }).theme).toBe('dark')
    expect(normalizeSettings({ theme: 'x' as never }).theme).toBe('system')
    expect(normalizeSettings({ locale: 'en' }).locale).toBe('en')
    expect(normalizeSettings({ locale: 'x' as never }).locale).toBe('system')
    expect(normalizeSettings({ fontScale: 1.25 }).fontScale).toBe(1.25)
    expect(normalizeSettings({ fontScale: 1.2 }).fontScale).toBe(1)
    expect(normalizeSettings({ ballDomainMode: 'whitelist' }).ballDomainMode).toBe('whitelist')
    expect(normalizeSettings({ ballDomainMode: 'x' as never }).ballDomainMode).toBe('blacklist')
  })

  it('域名规则清洗：去空白、转小写、去重、丢弃非字符串', () => {
    const res = normalizeSettings({
      ballBlacklist: [' A.com ', 'a.com', '', 1 as never, null as never],
      ballWhitelist: 'not-an-array' as never,
    })
    expect(res.ballBlacklist).toEqual(['a.com'])
    expect(res.ballWhitelist).toEqual([])
  })

  it('工具顺序与显隐按 normalizeToolLayout 兜底', () => {
    const res = normalizeSettings({
      toolOrder: ['json', 'json', 'bogus' as never],
      toolEnabled: { json: false },
    })
    expect(res.toolOrder).toHaveLength(9)
    expect(new Set(res.toolOrder).size).toBe(9)
    expect(res.toolOrder[0]).toBe('json')
    expect(res.toolEnabled.json).toBe(false)
    expect(res.toolEnabled.jwt).toBe(false)
    expect(res.toolEnabled.base64).toBe(true)
  })
})

describe('registry 兜底与可见性', () => {
  it('defaultToolLayout 覆盖全部已注册工具，JWT 与哈希默认隐藏', () => {
    const layout = defaultToolLayout()
    expect(layout.order).toHaveLength(9)
    expect(layout.enabled.jwt).toBe(false)
    expect(layout.enabled.hash).toBe(false)
    expect(Object.values(layout.enabled).filter(Boolean)).toHaveLength(7)
  })

  it('normalizeToolLayout 剔除未知 id、去重并补齐缺失工具', () => {
    const layout = normalizeToolLayout(['base64', 'base64', 'unknown'], undefined)
    expect(layout.order).toHaveLength(9)
    expect(new Set(layout.order).size).toBe(9)
    expect(layout.order[0]).toBe('base64')
    expect(layout.order).not.toContain('unknown')
  })

  it('存储中标记为 false 的工具保持隐藏，新增工具回退产品默认', () => {
    const layout = normalizeToolLayout(undefined, { hash: true, base64: false })
    expect(layout.enabled.hash).toBe(true)
    expect(layout.enabled.base64).toBe(false)
    expect(layout.enabled.jwt).toBe(false)
  })

  it('非数组顺序参数不抛错', () => {
    expect(() => normalizeToolLayout('nope', null)).not.toThrow()
    expect(normalizeToolLayout('nope', null).order).toHaveLength(9)
  })

  it('visibleTools 按顺序返回可见工具（默认 7 个，首个为智能解析）', () => {
    const tools = visibleTools(defaultToolLayout())
    expect(tools).toHaveLength(7)
    expect(tools[0].id).toBe('detect')
    expect(tools.map((t) => t.id)).not.toContain('jwt')
  })

  it('isToolId 只认可注册表内的 id', () => {
    expect(isToolId('json')).toBe(true)
    expect(isToolId('bogus')).toBe(false)
    expect(isToolId(undefined)).toBe(false)
  })
})

/** T133：设置类写入必须把失败信号交回调用方，由调用方提示用户 */
describe('saveSettings / setBallImage 的失败信号', () => {
  /** 用 unknown 断开与 @types/chrome 的强类型绑定：这里只需要一个「可写可删」的桩 */
  const globalWithChrome = globalThis as unknown as { chrome?: unknown }

  const stubChrome = (set: () => Promise<void>) => {
    globalWithChrome.chrome = {
      storage: { sync: { set }, local: { set }, session: { set } },
    }
  }

  afterEach(() => {
    delete globalWithChrome.chrome
  })

  it('saveSettings 成功返回 true，配额失败返回 false', async () => {
    stubChrome(async () => {})
    await expect(saveSettings(defaultSettings())).resolves.toBe(true)

    stubChrome(async () => {
      throw new Error('quota exceeded')
    })
    await expect(saveSettings(defaultSettings())).resolves.toBe(false)
  })

  it('saveSettings 在非扩展环境返回 false', async () => {
    await expect(saveSettings(defaultSettings())).resolves.toBe(false)
  })

  it('setBallImage 超限时返回 too-large，且不触碰存储', async () => {
    let wrote = false
    stubChrome(async () => {
      wrote = true
    })
    const oversized = `data:image/png;base64,${'A'.repeat(BALL_IMAGE_MAX_DATA_URL_LENGTH)}`
    await expect(setBallImage(oversized)).resolves.toEqual({ ok: false, reason: 'too-large' })
    expect(wrote).toBe(false)
  })

  it('setBallImage 写入失败返回 write-failed，成功返回 ok（不再抛异常）', async () => {
    stubChrome(async () => {
      throw new Error('quota exceeded')
    })
    await expect(setBallImage(null)).resolves.toEqual({ ok: false, reason: 'write-failed' })

    stubChrome(async () => {})
    await expect(setBallImage(null)).resolves.toEqual({ ok: true })
  })
})

/** 默认值形状是「兼容旧数据」的基线：任何字段缺失/类型错误最终都要回到这里，字段漏一个升级就会错乱 */
describe('defaultSettings 完整形状', () => {
  it('包含全部字段，取值与产品默认一致', () => {
    const expectedEnabled: Record<string, boolean> = {}
    for (const t of DEFAULT_TOOLS) expectedEnabled[t.id] = t.id !== 'jwt' && t.id !== 'hash'

    expect(defaultSettings()).toEqual({
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
      toolOrder: DEFAULT_TOOLS.map((t) => t.id),
      toolEnabled: expectedEnabled,
    })
  })

  it('UI 下拉常量里的每个选项都能通过归一化（选项与兜底白名单不能自相矛盾）', () => {
    for (const o of THEME_OPTIONS) expect(normalizeSettings({ theme: o.value }).theme).toBe(o.value)
    for (const o of LOCALE_OPTIONS)
      expect(normalizeSettings({ locale: o.value }).locale).toBe(o.value)
    for (const o of FONT_SCALE_OPTIONS)
      expect(normalizeSettings({ fontScale: o.value }).fontScale).toBe(o.value)
  })
})

describe('normalizeSettings：类型全错与部分字段', () => {
  it('字段类型全错时逐字段回退默认值', () => {
    const res = normalizeSettings({
      ballDockMode: 1 as never,
      ballBottomRightRight: {} as never,
      ballBottomRightBottom: [] as never,
      ballShape: 7 as never,
      ballPreset: null as never,
      ballSize: undefined,
      ballAction: 5 as never,
      ballDomainMode: [] as never,
      ballBlacklist: {} as never,
      ballWhitelist: 3 as never,
      theme: {} as never,
      locale: null as never,
      fontScale: '1.25' as never,
      toolOrder: {} as never,
      toolEnabled: 'nope' as never,
    })
    expect(res).toEqual(defaultSettings())
  })

  it('只给部分合法字段时，其余字段保持默认（不互相污染）', () => {
    const res = normalizeSettings({ theme: 'dark', ballSize: 'lg' })
    const base = defaultSettings()
    expect(res.theme).toBe('dark')
    expect(res.ballSize).toBe('lg')
    expect({ ...res, theme: base.theme, ballSize: base.ballSize }).toEqual(base)
  })

  it('NaN 不会渗进边距字段（避免写进存储后变成 NaN 破坏布局）', () => {
    const res = normalizeSettings({ ballBottomRightRight: Number.NaN })
    expect(res.ballBottomRightRight).toBe(80)
    expect(Number.isFinite(res.ballBottomRightBottom)).toBe(true)
  })
})

describe('normalizeBallShape / normalizeBallPreset / normalizeBallSize 取值全集', () => {
  it('形状：circle / rounded / square 合法，其余回退 circle', () => {
    expect(normalizeSettings({ ballShape: 'circle' }).ballShape).toBe('circle')
    expect(normalizeSettings({ ballShape: 'square' }).ballShape).toBe('square')
    expect(normalizeSettings({ ballShape: 'rounded' }).ballShape).toBe('rounded')
    const bad: unknown[] = ['', 'CIRCLE', 'triangle', 0, null, undefined, {}, []]
    for (const v of bad)
      expect(normalizeSettings({ ballShape: v as never }).ballShape).toBe('circle')
  })

  it('预设：outline / soft 合法，其余回退 primary', () => {
    expect(normalizeSettings({ ballPreset: 'outline' }).ballPreset).toBe('outline')
    expect(normalizeSettings({ ballPreset: 'soft' }).ballPreset).toBe('soft')
    expect(normalizeSettings({ ballPreset: 'primary' }).ballPreset).toBe('primary')
    const bad: unknown[] = ['PRIMARY', 'ghost', 1, null, undefined, {}]
    for (const v of bad)
      expect(normalizeSettings({ ballPreset: v as never }).ballPreset).toBe('primary')
  })

  it('大小：sm / md / lg 合法，其余回退 sm', () => {
    expect(normalizeSettings({ ballSize: 'sm' }).ballSize).toBe('sm')
    expect(normalizeSettings({ ballSize: 'lg' }).ballSize).toBe('lg')
    expect(normalizeSettings({ ballSize: 'md' }).ballSize).toBe('md')
    const bad: unknown[] = ['SM', 'xl', 44, null, undefined, {}]
    for (const v of bad) expect(normalizeSettings({ ballSize: v as never }).ballSize).toBe('sm')
  })

  it('主题 / 语言 / 字号只接受白名单内的值', () => {
    for (const v of ['DARK', 'auto', 0, null, undefined, {}] as unknown[])
      expect(normalizeSettings({ theme: v as never }).theme).toBe('system')
    for (const v of ['ZH', 'ja', 0, null, undefined] as unknown[])
      expect(normalizeSettings({ locale: v as never }).locale).toBe('system')
    // 字号是数字枚举：字符串 '1.25' 与相邻的 1.2 都不在白名单内
    for (const v of ['1.25', 1.2, 0, null, undefined, Number.NaN] as unknown[])
      expect(normalizeSettings({ fontScale: v as never }).fontScale).toBe(1)
  })

  it('点击行为：只有 native 生效，其余回退 drawer', () => {
    expect(normalizeSettings({ ballAction: 'native' }).ballAction).toBe('native')
    for (const v of ['NATIVE', 'drawer', '', null, undefined, 1] as unknown[])
      expect(normalizeSettings({ ballAction: v as never }).ballAction).toBe('drawer')
  })

  it('域名模式：只有 whitelist 生效，其余一律 blacklist（默认放过）', () => {
    expect(normalizeSettings({ ballDomainMode: 'blacklist' }).ballDomainMode).toBe('blacklist')
    for (const v of ['WHITELIST', 'allow', 0, null, undefined] as unknown[])
      expect(normalizeSettings({ ballDomainMode: v as never }).ballDomainMode).toBe('blacklist')
  })
})

describe('normalizeOffset 边界（经由 ballBottomRight* 字段）', () => {
  const right = (v: unknown) =>
    normalizeSettings({ ballBottomRightRight: v as never }).ballBottomRightRight
  const bottom = (v: unknown) =>
    normalizeSettings({ ballBottomRightBottom: v as never }).ballBottomRightBottom

  it('数字：四舍五入取整、负数归零、超 800 夹取', () => {
    expect(right(0)).toBe(0)
    expect(right(80.4)).toBe(80)
    expect(right(80.6)).toBe(81)
    expect(right(-1)).toBe(0)
    expect(right(800)).toBe(800)
    expect(right(801)).toBe(800)
    expect(right(99999)).toBe(800)
  })

  it('字符串数字：parseInt 解析（截断小数），超范围同样夹取', () => {
    expect(right('120')).toBe(120)
    expect(right(' 40 ')).toBe(40)
    expect(right('120abc')).toBe(120)
    expect(right('12.9')).toBe(12)
    expect(right('1000')).toBe(800)
    expect(right('-5')).toBe(0)
  })

  it('空串 / 非数字 / 非字符串类型回退默认 80，不产生 NaN', () => {
    const bad: unknown[] = ['abc', '', '   ', null, undefined, true, false, {}, []]
    for (const v of bad) expect(right(v)).toBe(80)
    expect(right(Number.NaN)).toBe(80)
    // ±Infinity 仍是 number，会被夹取到边界而不是回退
    expect(right(Number.POSITIVE_INFINITY)).toBe(800)
    expect(right(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(bottom(Number.NaN)).toBe(80)
    expect(bottom('999')).toBe(800)
    expect(bottom(-999)).toBe(0)
  })
})

describe('normalizeDomainList 清洗规则', () => {
  it('trim + 小写 + 去重（保留首次出现顺序）', () => {
    expect(
      normalizeSettings({ ballBlacklist: [' B.com ', 'a.com', 'A.COM', 'b.com', 'a.com'] })
        .ballBlacklist,
    ).toEqual(['b.com', 'a.com'])
  })

  it('过滤空串、纯空白与非字符串项', () => {
    expect(
      normalizeSettings({
        ballBlacklist: [
          '',
          '   ',
          1,
          true,
          null,
          undefined,
          {},
          [],
          ['a.com'],
        ] as unknown as string[],
      }).ballBlacklist,
    ).toEqual([])
  })

  it('非数组直接回退空数组', () => {
    for (const v of ['a.com', 1, {}, true, null, undefined] as unknown[])
      expect(normalizeSettings({ ballWhitelist: v as never }).ballWhitelist).toEqual([])
  })
})

describe('ballAssetUrl 的环境降级', () => {
  /** 用 unknown 断开与 @types/chrome 的强类型绑定，方便构造「chrome 存在但残缺」的环境 */
  const globalWithChrome = globalThis as unknown as { chrome?: unknown }

  afterEach(() => {
    delete globalWithChrome.chrome
  })

  it('无 chrome 时回退为站内绝对路径', () => {
    expect(ballAssetUrl('ball-default.png')).toBe('/ball-default.png')
  })

  it('扩展环境用 chrome.runtime.getURL，并原样透传路径', () => {
    const calls: string[] = []
    globalWithChrome.chrome = {
      runtime: {
        getURL: (p: string) => {
          calls.push(p)
          return `chrome-extension://abc/${p}`
        },
      },
    }
    expect(ballAssetUrl('icons/ball.png')).toBe('chrome-extension://abc/icons/ball.png')
    expect(calls).toEqual(['icons/ball.png'])
  })

  it('getURL 抛错 / runtime 缺失 / chrome 为 null 时都回退，不把异常抛给渲染层', () => {
    globalWithChrome.chrome = {
      runtime: {
        getURL: () => {
          throw new Error('boom')
        },
      },
    }
    expect(ballAssetUrl('a.png')).toBe('/a.png')

    globalWithChrome.chrome = {}
    expect(ballAssetUrl('a.png')).toBe('/a.png')

    globalWithChrome.chrome = { runtime: {} }
    expect(ballAssetUrl('a.png')).toBe('/a.png')

    globalWithChrome.chrome = null
    expect(ballAssetUrl('a.png')).toBe('/a.png')
  })
})

describe('getBallImage / setBallImage 的存储交互与体积边界', () => {
  const globalWithChrome = globalThis as unknown as { chrome?: unknown }
  const writes: unknown[] = []

  function stubStorage(opts: { getResult?: unknown; failSet?: boolean } = {}) {
    const area = {
      get: async () => opts.getResult ?? {},
      set: async (payload: unknown) => {
        writes.push(payload)
        if (opts.failSet) throw new Error('QUOTA_BYTES quota exceeded')
      },
    }
    globalWithChrome.chrome = { storage: { local: area, sync: area, session: area } }
  }

  afterEach(() => {
    delete globalWithChrome.chrome
    writes.length = 0
  })

  it('getBallImage 读到值返回原串，缺失返回 null', async () => {
    stubStorage({ getResult: { [BALL_IMAGE_KEY]: 'data:image/png;base64,AAAA' } })
    await expect(getBallImage()).resolves.toBe('data:image/png;base64,AAAA')

    stubStorage({ getResult: {} })
    await expect(getBallImage()).resolves.toBeNull()
  })

  it('长度正好等于上限可写入，上限 +1 拒绝且不落盘', async () => {
    stubStorage()
    const atLimit = 'A'.repeat(BALL_IMAGE_MAX_DATA_URL_LENGTH)
    await expect(setBallImage(atLimit)).resolves.toEqual({ ok: true })
    expect(writes).toEqual([{ [BALL_IMAGE_KEY]: atLimit }])

    writes.length = 0
    const overLimit = 'A'.repeat(BALL_IMAGE_MAX_DATA_URL_LENGTH + 1)
    await expect(setBallImage(overLimit)).resolves.toEqual({ ok: false, reason: 'too-large' })
    expect(writes).toEqual([])
  })

  it('BALL_IMAGE_MAX_DATA_URL_LENGTH 由 128KB 上限换算而来', () => {
    expect(BALL_IMAGE_MAX_BYTES).toBe(128 * 1024)
    expect(BALL_IMAGE_MAX_DATA_URL_LENGTH).toBe(Math.ceil((128 * 1024 * 4) / 3) + 512)
    expect(BALL_IMAGE_MAX_DATA_URL_LENGTH).toBe(175275)
  })

  it('setBallImage(null) 以 null 落盘实现清除，空串按普通值写入', async () => {
    stubStorage()
    await expect(setBallImage(null)).resolves.toEqual({ ok: true })
    expect(writes).toEqual([{ [BALL_IMAGE_KEY]: null }])

    writes.length = 0
    await expect(setBallImage('')).resolves.toEqual({ ok: true })
    expect(writes).toEqual([{ [BALL_IMAGE_KEY]: '' }])
  })

  it('写入失败返回 write-failed，调用方据此提示用户', async () => {
    stubStorage({ failSet: true })
    await expect(setBallImage('data:image/png;base64,AAAA')).resolves.toEqual({
      ok: false,
      reason: 'write-failed',
    })
  })
})

describe('saveSettings 透传 storageSet 结果', () => {
  const globalWithChrome = globalThis as unknown as { chrome?: unknown }
  const writes: unknown[] = []

  afterEach(() => {
    delete globalWithChrome.chrome
    writes.length = 0
  })

  it('成功时把完整 Settings 写到 sync.settings 并返回 true', async () => {
    globalWithChrome.chrome = {
      storage: {
        sync: {
          set: async (payload: unknown) => {
            writes.push(payload)
          },
        },
      },
    }
    const s = defaultSettings()
    await expect(saveSettings(s)).resolves.toBe(true)
    expect(writes).toEqual([{ settings: s }])
  })

  it('底层抛错（配额）时返回 false，不把失败伪装成成功', async () => {
    globalWithChrome.chrome = {
      storage: {
        sync: {
          set: async () => {
            throw new Error('quota')
          },
        },
      },
    }
    await expect(saveSettings(defaultSettings())).resolves.toBe(false)
  })
})
