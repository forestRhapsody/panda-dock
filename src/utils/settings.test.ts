import { describe, expect, it } from 'vitest'

import { defaultToolLayout, isToolId, normalizeToolLayout, visibleTools } from '@/tools/registry'
import { defaultSettings, normalizeSettings } from '@/utils/settings'

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
    expect(normalizeSettings({ ballShape: 'rounded' }).ballShape).toBe('rounded')
    expect(normalizeSettings({ ballShape: '三角' as never }).ballShape).toBe('circle')
    expect(normalizeSettings({ ballPreset: 'soft' }).ballPreset).toBe('soft')
    expect(normalizeSettings({ ballPreset: 'nope' as never }).ballPreset).toBe('primary')
    expect(normalizeSettings({ ballSize: 'lg' }).ballSize).toBe('lg')
    expect(normalizeSettings({ ballSize: 'xl' as never }).ballSize).toBe('md')
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
