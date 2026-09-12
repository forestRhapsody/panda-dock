import { describe, expect, it } from 'vitest'

import { parseCustomDate, parseStamp, toLocalText, toRelative } from './timestamp'

describe('parseCustomDate', () => {
  it('原生可解析的格式直接交给 Date', () => {
    expect(parseCustomDate('2025-01-01T00:00:00Z')?.getTime()).toBe(Date.UTC(2025, 0, 1))
  })

  it('中文年月日 + 点分时间', () => {
    const d = parseCustomDate('2025年1月1日 15点30分20秒')
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getMonth()).toBe(0)
    expect(d?.getDate()).toBe(1)
    expect(d?.getHours()).toBe(15)
    expect(d?.getMinutes()).toBe(30)
    expect(d?.getSeconds()).toBe(20)
  })

  it('中文年月日 + 冒号时间', () => {
    const d = parseCustomDate('2025年1月1日 15:30:00')
    expect(d?.getHours()).toBe(15)
    expect(d?.getMinutes()).toBe(30)
    expect(d?.getSeconds()).toBe(0)
  })

  it('仅中文日期时时间为 00:00:00', () => {
    const d = parseCustomDate('2025年01月01号')
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getMonth()).toBe(0)
    expect(d?.getDate()).toBe(1)
    expect(d?.getHours()).toBe(0)
  })

  it('「时 / 分」写法', () => {
    const d = parseCustomDate('2025年01月01日 15时30分')
    expect(d?.getHours()).toBe(15)
    expect(d?.getMinutes()).toBe(30)
  })

  it('标准日期前缀 + 中文时间（混合写法）', () => {
    const d = parseCustomDate('2025-01-01 15点30分')
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getHours()).toBe(15)
    expect(d?.getMinutes()).toBe(30)
  })

  it('越界数值一律判为无法解析，不做日期滚动', () => {
    expect(parseCustomDate('2025年13月1日')).toBeNull()
    expect(parseCustomDate('2025年1月32日')).toBeNull()
    expect(parseCustomDate('2025年1月1日 25点00分')).toBeNull()
    expect(parseCustomDate('2025年1月1日 15点70分')).toBeNull()
  })

  it('完全无法识别的文本返回 null', () => {
    expect(parseCustomDate('不是日期')).toBeNull()
  })
})

describe('parseStamp', () => {
  it('10 位及以下纯数字按 Unix 秒解析', () => {
    const res = parseStamp('1780000000')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.source).toBe('secs')
    expect(res.rows[0].value).toBe('1780000000')
  })

  it('11 位及以上纯数字按 Unix 毫秒解析', () => {
    const res = parseStamp('1780000000000')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.source).toBe('ms')
    expect(res.rows[0].value).toBe('1780000000')
    expect(res.rows[1].value).toBe('1780000000000')
  })

  it('负时间戳按去掉负号后的位数判定秒 / 毫秒（1970 以前不误判）', () => {
    const secs = parseStamp('-1000000000')
    expect(secs.ok).toBe(true)
    if (!secs.ok) return
    expect(secs.source).toBe('secs')
    expect(secs.rows[0].value).toBe('-1000000000')

    const ms = parseStamp('-1000000000000')
    expect(ms.ok).toBe(true)
    if (!ms.ok) return
    expect(ms.source).toBe('ms')
    expect(ms.rows[1].value).toBe('-1000000000000')
  })

  it('日期文本走 text 分支', () => {
    const res = parseStamp('2025-01-01 00:00:00')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.source).toBe('text')
  })

  it('固定输出 6 行结果（无重复的「本地时间（可读）」行）', () => {
    const res = parseStamp('1780000000')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rows).toHaveLength(6)
    expect(res.rows.every((r) => r.label.length > 0 && r.value.length > 0)).toBe(true)
    expect(res.rows[2].value).toBe(new Date(1780000000 * 1000).toISOString())
  })

  it('空串 / 无法解析的文本返回 ok:false', () => {
    expect(parseStamp('').ok).toBe(false)
    expect(parseStamp('   ').ok).toBe(false)
    expect(parseStamp('随便写点什么').ok).toBe(false)
  })

  it('超出 Date 范围的数字不抛错', () => {
    expect(() => parseStamp('99999999999999999999')).not.toThrow()
  })
})

describe('toLocalText / toRelative', () => {
  it('本地时间按固定格式补零', () => {
    expect(toLocalText(new Date(2025, 0, 2, 3, 4, 5))).toBe('2025-01-02 03:04:05')
  })

  it('相对时间对当前时刻给出可读文案', () => {
    const text = toRelative(new Date())
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })
})
