import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TOOLS,
  defaultToolLayout,
  isToolId,
  normalizeToolLayout,
  visibleTools,
} from './registry'
import type { ToolId } from './registry'

/**
 * registry 是工具清单的唯一事实来源（AGENTS.md §3）：
 * 顺序 = 默认选项卡顺序，id 唯一性由 TS 的 ToolId 保证，但运行时数据（storage）不可信，
 * 因此这里同时钉住「注册表契约」与 normalizeToolLayout 对旧数据的兜底行为。
 */
const EXPECTED_IDS: ToolId[] = [
  'detect',
  'storage',
  'base64',
  'json',
  'url',
  'timestamp',
  'qrcode',
  'jwt',
  'hash',
]

/** 产品默认隐藏（可在 Options 开启）的工具 */
const HIDDEN_BY_DEFAULT: ToolId[] = ['jwt', 'hash']

/** 把全部工具都设为隐藏，用于验证 visibleTools 的空结果分支 */
function allDisabled(): Record<string, boolean> {
  return Object.fromEntries(EXPECTED_IDS.map((id) => [id, false]))
}

describe('DEFAULT_TOOLS 注册表契约', () => {
  it('顺序与 AGENTS.md 表格一致（顺序 = 默认选项卡顺序）', () => {
    expect(DEFAULT_TOOLS.map((t) => t.id)).toEqual(EXPECTED_IDS)
  })

  it('id 唯一、label 非空且唯一', () => {
    const ids = DEFAULT_TOOLS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const labels = DEFAULT_TOOLS.map((t) => t.label)
    expect(labels.every((l) => l.trim().length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('isToolId 只认可注册表内的 id（大小写敏感、拒绝非字符串）', () => {
    for (const t of DEFAULT_TOOLS) expect(isToolId(t.id)).toBe(true)
    for (const bad of ['', 'unknown', 'JWT', 'Json', ' detect', 0, null, undefined, {}, []]) {
      expect(isToolId(bad)).toBe(false)
    }
  })
})

describe('defaultToolLayout', () => {
  it('顺序覆盖全部工具，仅 JWT / Hash 默认隐藏', () => {
    const layout = defaultToolLayout()
    expect(layout.order).toEqual(EXPECTED_IDS)
    for (const id of EXPECTED_IDS) {
      expect(layout.enabled[id]).toBe(!HIDDEN_BY_DEFAULT.includes(id))
    }
  })

  it('每次调用返回独立对象，改动一次不影响下一次（避免设置页改动污染默认值）', () => {
    const a = defaultToolLayout()
    a.order.length = 0
    a.enabled.json = false
    const b = defaultToolLayout()
    expect(b.order).toEqual(EXPECTED_IDS)
    expect(b.enabled.json).toBe(true)
  })
})

describe('normalizeToolLayout：兼容缺失 / 非数组 / 未知 id', () => {
  it('undefined / null / 非数组顺序都回退为完整且无重复的默认顺序', () => {
    const inputs: unknown[] = [undefined, null, 'nope', 1, {}, ['json', 1, null, 'unknown']]
    for (const input of inputs) {
      const layout = normalizeToolLayout(input, undefined)
      expect(layout.order).toHaveLength(EXPECTED_IDS.length)
      expect(new Set(layout.order).size).toBe(EXPECTED_IDS.length)
    }
    expect(normalizeToolLayout(undefined, undefined).order).toEqual(EXPECTED_IDS)
  })

  it('剔除未知 id / 非字符串，去重且保留首次出现的位置', () => {
    const layout = normalizeToolLayout(['json', 'unknown', 'json', 1, null, 'base64'], null)
    expect(layout.order.slice(0, 2)).toEqual(['json', 'base64'])
    expect(layout.order).not.toContain('unknown')
    expect(layout.order).toHaveLength(EXPECTED_IDS.length)
    expect(new Set(layout.order).size).toBe(EXPECTED_IDS.length)
  })

  it('存储里缺失的新工具按注册表顺序追加到尾部（老用户升级后能看到新工具）', () => {
    const layout = normalizeToolLayout(['hash'], undefined)
    expect(layout.order[0]).toBe('hash')
    expect(layout.order.slice(1)).toEqual(EXPECTED_IDS.filter((id) => id !== 'hash'))
  })

  it('完全自定义的顺序被完整保留', () => {
    const reversed = [...EXPECTED_IDS].reverse()
    expect(normalizeToolLayout(reversed, {}).order).toEqual(reversed)
  })
})

describe('normalizeToolLayout：enabled 存量优先与缺省回退', () => {
  it('未存过时回退产品默认（jwt / hash 隐藏）', () => {
    expect(normalizeToolLayout(undefined, undefined).enabled).toEqual(defaultToolLayout().enabled)
  })

  it('存过的值优先：显式 false 隐藏，显式 true 可开启默认隐藏项', () => {
    const layout = normalizeToolLayout(undefined, { base64: false, jwt: true, hash: true })
    expect(layout.enabled.base64).toBe(false)
    expect(layout.enabled.jwt).toBe(true)
    expect(layout.enabled.hash).toBe(true)
    // 未存过的可见工具仍回退产品默认 true
    expect(layout.enabled.json).toBe(true)
  })

  it('只有显式 false 才当作隐藏，历史数据里的非布尔真值不误伤', () => {
    // 存储桥 / 旧版本可能写进 0、'yes'、null 等值；实现用 `!== false` 判定，这些视为「开启」
    const layout = normalizeToolLayout(undefined, { json: 0, jwt: 'yes', hash: null })
    expect(layout.enabled.json).toBe(true)
    expect(layout.enabled.jwt).toBe(true)
    expect(layout.enabled.hash).toBe(true)
  })

  it('非对象 enabled 输入不抛错并回退默认', () => {
    const bads: unknown[] = [null, 'x', 3, [], true]
    for (const bad of bads) {
      expect(normalizeToolLayout(['json'], bad).enabled).toEqual(defaultToolLayout().enabled)
    }
  })
})

describe('visibleTools：过滤 + 保序', () => {
  it('默认布局返回 7 个可见工具且保持注册顺序', () => {
    const tools = visibleTools(defaultToolLayout())
    expect(tools.map((t) => t.id)).toEqual(
      EXPECTED_IDS.filter((id) => !HIDDEN_BY_DEFAULT.includes(id)),
    )
    expect(tools.every((t) => t.label.trim().length > 0)).toBe(true)
  })

  it('尊重用户自定义顺序而不是注册表顺序', () => {
    const reversed = [...EXPECTED_IDS].reverse()
    const layout = normalizeToolLayout(reversed, { jwt: true, hash: true })
    expect(visibleTools(layout).map((t) => t.id)).toEqual(reversed)
  })

  it('过滤未注册 id 与显式隐藏项，其余保持顺序', () => {
    const layout = {
      order: ['bogus', 'json', 'base64'] as ToolId[],
      enabled: { json: true, base64: false },
    }
    expect(visibleTools(layout).map((t) => t.id)).toEqual(['json'])
  })

  it('全部隐藏或顺序为空时返回空数组', () => {
    const off = allDisabled()
    expect(visibleTools({ order: EXPECTED_IDS, enabled: off })).toEqual([])
    expect(visibleTools({ order: [], enabled: off })).toEqual([])
    expect(visibleTools({ order: ['bogus'] as unknown as ToolId[], enabled: {} })).toEqual([])
  })
})
