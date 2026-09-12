import { afterEach, describe, expect, it } from 'vitest'

import { defaultToolLayout, isToolId, normalizeToolLayout, visibleTools } from '@/tools/registry'
import {
  BALL_IMAGE_MAX_DATA_URL_LENGTH,
  defaultSettings,
  normalizeSettings,
  saveSettings,
  setBallImage,
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
    expect(normalizeSettings({ ballShape: '三角' as never }).ballShape).toBe('rounded')
    expect(normalizeSettings({ ballPreset: 'soft' }).ballPreset).toBe('soft')
    expect(normalizeSettings({ ballPreset: 'nope' as never }).ballPreset).toBe('primary')
    expect(normalizeSettings({ ballSize: 'lg' }).ballSize).toBe('lg')
    expect(normalizeSettings({ ballSize: 'xl' as never }).ballSize).toBe('md')
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
