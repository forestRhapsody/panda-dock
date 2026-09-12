import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import { parseCustomDate, parseStamp, toLocalText, toRelative } from './timestamp'

/** 中日韩字符与全角标点：用来断言「英文界面下不出现中文」 */
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

/** 固定「现在」，避免相对时间用例随运行时刻漂移 */
const NOW_MS = 1_700_000_000_000 // 2023-11-14T22:13:20Z

describe('toLocalText', () => {
  it('按本地日历输出 YYYY-MM-DD HH:mm:ss 并补零', () => {
    expect(toLocalText(new Date(2025, 0, 2, 3, 4, 5))).toBe('2025-01-02 03:04:05')
    expect(toLocalText(new Date(2025, 11, 31, 23, 59, 59))).toBe('2025-12-31 23:59:59')
  })

  it('本地构造的日期经过 Date 归一化后按最终字段输出（非闰年 2 月 29 日滚到 3 月 1 日）', () => {
    expect(toLocalText(new Date(2025, 1, 29))).toBe('2025-03-01 00:00:00')
  })

  it('毫秒被截断（只输出到秒）', () => {
    expect(toLocalText(new Date(2025, 0, 2, 3, 4, 5, 999))).toBe('2025-01-02 03:04:05')
  })

  it('Invalid Date 退化为 NaN 文本而非抛错', () => {
    expect(toLocalText(new Date('nope'))).toBe('NaN-NaN-NaN NaN:NaN:NaN')
  })
})

describe('toRelative', () => {
  beforeEach(async () => {
    // 断言中文文案，先固定语言，避免依赖其它用例的执行顺序
    await i18n.changeLanguage('zh')
    vi.useFakeTimers({ now: NOW_MS })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('5 秒内视为「刚刚」（过去与未来一致）', () => {
    expect(toRelative(new Date(NOW_MS))).toBe('刚刚')
    expect(toRelative(new Date(NOW_MS - 4000))).toBe('刚刚')
    expect(toRelative(new Date(NOW_MS + 4000))).toBe('刚刚')
  })

  it('按 年 / 月 / 天 / 小时 / 分钟 / 秒 逐级取整，并区分过去与未来', () => {
    expect(toRelative(new Date(NOW_MS + 5_000))).toBe('5 秒后')
    expect(toRelative(new Date(NOW_MS - 5_000))).toBe('5 秒前')
    expect(toRelative(new Date(NOW_MS + 60_000))).toBe('1 分钟后')
    expect(toRelative(new Date(NOW_MS + 3_600_000))).toBe('1 小时后')
    expect(toRelative(new Date(NOW_MS + 86_400_000))).toBe('1 天后')
    expect(toRelative(new Date(NOW_MS + 2_592_000_000))).toBe('1 个月后')
    expect(toRelative(new Date(NOW_MS + 31_536_000_000))).toBe('1 年后')
  })

  it('边界不跳级：59 秒仍是秒，29 天仍是天，30 天进位到月，365 天进位到年', () => {
    expect(toRelative(new Date(NOW_MS + 59_000))).toBe('59 秒后')
    expect(toRelative(new Date(NOW_MS + 29 * 86_400_000))).toBe('29 天后')
    expect(toRelative(new Date(NOW_MS + 30 * 86_400_000))).toBe('1 个月后')
    expect(toRelative(new Date(NOW_MS + 364 * 86_400_000))).toBe('12 个月后')
    expect(toRelative(new Date(NOW_MS + 365 * 86_400_000))).toBe('1 年后')
  })

  it('按 round 取最近整秒，避免边界抖动', () => {
    expect(toRelative(new Date(NOW_MS + 4_600))).toBe('5 秒后')
    expect(toRelative(new Date(NOW_MS + 4_400))).toBe('刚刚') // round(4.4) = 4 < 5
    expect(toRelative(new Date(NOW_MS - 4_600))).toBe('5 秒前')
  })
})

describe('parseCustomDate 中文日期', () => {
  it('中文年月日（日 / 号可省）默认零点，月日补零可选', () => {
    for (const text of ['2025年1月1日', '2025年01月01号', '2025年1月1']) {
      const d = parseCustomDate(text)
      expect(d?.getFullYear(), text).toBe(2025)
      expect(d?.getMonth(), text).toBe(0)
      expect(d?.getDate(), text).toBe(1)
      expect(d?.getHours(), text).toBe(0)
      expect(d?.getMinutes(), text).toBe(0)
      expect(d?.getSeconds(), text).toBe(0)
    }
  })

  it('中文日期 + 冒号时间（秒可省）', () => {
    const withSec = parseCustomDate('2025年1月1日 15:30:20')
    expect([withSec?.getHours(), withSec?.getMinutes(), withSec?.getSeconds()]).toEqual([
      15, 30, 20,
    ])

    const noSec = parseCustomDate('2025年1月1日 15:30')
    expect([noSec?.getHours(), noSec?.getMinutes(), noSec?.getSeconds()]).toEqual([15, 30, 0])
  })

  it('中文日期 + 「点 / 时 分 秒」写法（分秒可省）', () => {
    const full = parseCustomDate('2025年1月1日 15点30分20秒')
    expect([full?.getHours(), full?.getMinutes(), full?.getSeconds()]).toEqual([15, 30, 20])

    const noSec = parseCustomDate('2025年1月1日 15时30分')
    expect([noSec?.getHours(), noSec?.getMinutes(), noSec?.getSeconds()]).toEqual([15, 30, 0])

    const hourOnly = parseCustomDate('2025年1月1日 15点')
    expect([hourOnly?.getHours(), hourOnly?.getMinutes(), hourOnly?.getSeconds()]).toEqual([
      15, 0, 0,
    ])
  })

  it('时间部分无法识别时返回 null', () => {
    expect(parseCustomDate('2025年1月1日 下午三点')).toBeNull()
    expect(parseCustomDate('2025年1月1日 abc')).toBeNull()
    expect(parseCustomDate('2025年1月1日 15:30:00 多余')).toBeNull()
  })

  it('月 / 日 / 时 / 分 / 秒 越界一律返回 null', () => {
    expect(parseCustomDate('2025年0月1日')).toBeNull()
    expect(parseCustomDate('2025年13月1日')).toBeNull()
    expect(parseCustomDate('2025年1月0日')).toBeNull()
    expect(parseCustomDate('2025年1月32日')).toBeNull()
    expect(parseCustomDate('2025年1月1日 24:00')).toBeNull()
    expect(parseCustomDate('2025年1月1日 15:60')).toBeNull()
    expect(parseCustomDate('2025年1月1日 15:30:60')).toBeNull()
  })

  it('中文分支不校验日期滚动：2 月 31 日会滚动到 3 月（记录现状，见源码疑点）', () => {
    const d = parseCustomDate('2025年2月31日')
    expect(d).not.toBeNull()
    expect(d?.getMonth()).toBe(2)
    expect(d?.getDate()).toBe(3)
  })

  it('包含中文但不符合中文日期规则时返回 null', () => {
    expect(parseCustomDate('今天是2025年1月1日')).toBeNull()
    expect(parseCustomDate('二零二五年一月一日')).toBeNull()
    expect(parseCustomDate('2025年')).toBeNull()
    expect(parseCustomDate('不是日期')).toBeNull()
    expect(parseCustomDate('')).toBeNull()
    expect(parseCustomDate('   ')).toBeNull()
  })

  it('标准日期前缀 + 中文时间（混合写法）', () => {
    for (const text of ['2025-01-01 15点30分', '2025/01/01 15点30分20秒', '2025.01.01 15点30分']) {
      const d = parseCustomDate(text)
      expect(d?.getFullYear(), text).toBe(2025)
      expect(d?.getMonth(), text).toBe(0)
      expect(d?.getDate(), text).toBe(1)
      expect(d?.getHours(), text).toBe(15)
      expect(d?.getMinutes(), text).toBe(30)
    }
  })
})

describe('parseCustomDate 标准数字日期', () => {
  it('YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD 与 T 分隔的时间按本地时区解析', () => {
    const cases = [
      '2025-01-02 03:04:05',
      '2025/01/02 03:04:05',
      '2025.01.02 03:04:05',
      '2025-01-02T03:04:05',
    ]
    for (const text of cases) {
      const d = parseCustomDate(text)
      expect(
        [
          d?.getFullYear(),
          d?.getMonth(),
          d?.getDate(),
          d?.getHours(),
          d?.getMinutes(),
          d?.getSeconds(),
        ],
        text,
      ).toEqual([2025, 0, 2, 3, 4, 5])
    }
  })

  it('秒可省，毫秒保留到 Date', () => {
    const noSec = parseCustomDate('2025-01-02 03:04')
    expect([noSec?.getHours(), noSec?.getMinutes(), noSec?.getSeconds()]).toEqual([3, 4, 0])

    const withMs = parseCustomDate('2025-01-02 03:04:05.123')
    expect(withMs?.getSeconds()).toBe(5)
    expect(withMs?.getMilliseconds()).toBe(123)
  })

  it('带 Z / 时区偏移时按绝对时间解析（与运行环境时区无关）', () => {
    expect(parseCustomDate('2025-01-01T00:00:00Z')?.getTime()).toBe(Date.UTC(2025, 0, 1))
    expect(parseCustomDate('2025-01-01T12:00:00+08:00')?.toISOString()).toBe(
      '2025-01-01T04:00:00.000Z',
    )
    expect(parseCustomDate('2025-01-01T12:00:00+0800')?.toISOString()).toBe(
      '2025-01-01T04:00:00.000Z',
    )
  })

  it('ISO 纯日期（无时间）按 UTC 零点解析；本地与 UTC 不同日时源码会判无效（时区相关疑点）', () => {
    // 源码用本地字段校验滚动，而纯日期串被 Date 按 UTC 解析：
    // UTC 偏移为负的时区下本地日期会退到前一天，从而被误判为无效。
    const utcMidnight = new Date(Date.UTC(2025, 0, 1))
    const sameLocalDay =
      utcMidnight.getFullYear() === 2025 &&
      utcMidnight.getMonth() === 0 &&
      utcMidnight.getDate() === 1
    const d = parseCustomDate('2025-01-01')
    if (sameLocalDay) expect(d?.getTime()).toBe(Date.UTC(2025, 0, 1))
    else expect(d).toBeNull()
  })

  it('年-月-日 格式的越界 / 滚动日期通过本地字段比对被拒绝', () => {
    expect(parseCustomDate('2025-02-31')).toBeNull()
    expect(parseCustomDate('2025/02/31 00:00:00')).toBeNull()
    expect(parseCustomDate('2025-13-01 00:00:00')).toBeNull()
    expect(parseCustomDate('2025-01-01 25:00:00')).toBeNull()
  })

  it('月-日-年 格式不参与滚动校验：02/31/2025 会滚动到 3 月（记录现状，见源码疑点）', () => {
    // 源码的字段比对正则只匹配「4 位年在最前」的写法，US 风格因此漏掉滚动检查
    const d = parseCustomDate('02/31/2025')
    expect(d).not.toBeNull()
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getMonth()).toBe(2)
    expect(d?.getDate()).toBe(3)
  })

  it('闰年 2 月 29 日合法，平年 / 百年不闰为 null，四百年闰合法', () => {
    expect(parseCustomDate('2024/02/29 00:00:00')?.getDate()).toBe(29)
    expect(parseCustomDate('2023-02-29 00:00:00')).toBeNull()
    expect(parseCustomDate('2100/02/29 00:00:00')).toBeNull()
    expect(parseCustomDate('2000/02/29 00:00:00')?.getDate()).toBe(29)
  })

  it('年份超出 1900-2200 被拒绝，边界年份接受', () => {
    expect(parseCustomDate('1899-01-01 00:00:00')).toBeNull()
    expect(parseCustomDate('2201-01-01 00:00:00')).toBeNull()
    expect(parseCustomDate('1900-01-01 00:00:00')?.getFullYear()).toBe(1900)
    expect(parseCustomDate('2200-12-31 23:59:59')?.getFullYear()).toBe(2200)
  })

  it('US 风格 MM/DD/YYYY 按 Date 规则解析为月在前', () => {
    const d = parseCustomDate('02/03/2025')
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getMonth()).toBe(1)
    expect(d?.getDate()).toBe(3)
  })

  it('格式不完整 / 带尾部垃圾时不解析', () => {
    expect(parseCustomDate('25-01-01')).toBeNull()
    expect(parseCustomDate('2025-1')).toBeNull()
    expect(parseCustomDate('2025-01-01 15:30:00 extra')).toBeNull()
  })
})

describe('parseCustomDate 英文月份日期', () => {
  it('英文月份 + 4 位年份（RFC 2822 / HTTP Date / 美式与 AM-PM 写法）', () => {
    const local = parseCustomDate('Jan 01, 2025')
    expect([local?.getFullYear(), local?.getMonth(), local?.getDate(), local?.getHours()]).toEqual([
      2025, 0, 1, 0,
    ])
    expect(parseCustomDate('01 Jan 2025')?.getDate()).toBe(1)

    expect(parseCustomDate('Wed, 01 Jan 2025 00:00:00 GMT')?.toISOString()).toBe(
      '2025-01-01T00:00:00.000Z',
    )

    const ampm = parseCustomDate('January 1, 2025 3:04:05 PM')
    expect([ampm?.getHours(), ampm?.getMinutes(), ampm?.getSeconds()]).toEqual([15, 4, 5])
  })

  it('月份大小写不敏感', () => {
    expect(parseCustomDate('jan 01, 2025')?.getMonth()).toBe(0)
    expect(parseCustomDate('DEC 31, 2025')?.getMonth()).toBe(11)
  })

  it('缺少月份词 / 缺少 4 位年份 / 含非白名单单词时返回 null', () => {
    expect(parseCustomDate('Mon, 01 2025')).toBeNull()
    expect(parseCustomDate('Jan 01, 25')).toBeNull()
    expect(parseCustomDate('Jan 01, 2025 Debian')).toBeNull()
    expect(parseCustomDate('Debian GNU/Linux 12 (bookworm)')).toBeNull()
    expect(parseCustomDate('Ubuntu 22.04')).toBeNull()
    expect(parseCustomDate('Test 12')).toBeNull()
  })

  it('4 位年份超出 1900-2200 时拒绝，边界年份接受', () => {
    expect(parseCustomDate('Jan 01, 1899')).toBeNull()
    expect(parseCustomDate('Jan 01, 2201')).toBeNull()
    expect(parseCustomDate('Jan 01, 1900')?.getFullYear()).toBe(1900)
    expect(parseCustomDate('Dec 31, 2200')?.getFullYear()).toBe(2200)
  })

  it('英文分支不校验日期滚动：Feb 30 会滚动到 3 月（记录现状，见源码疑点）', () => {
    const d = parseCustomDate('Feb 30, 2025')
    expect(d?.getMonth()).toBe(2)
    expect(d?.getDate()).toBe(2)
  })

  it('白名单单词但 Date 解析不了（如序数词 1st）返回 null', () => {
    expect(parseCustomDate('Jan 1st, 2025')).toBeNull()
  })

  it('白名单内、Date 可解析的宽松写法按 Date 结果返回', () => {
    expect(parseCustomDate('Jan 2025')?.getMonth()).toBe(0)
    expect(parseCustomDate('Jan 2025')?.getDate()).toBe(1)
  })
})

describe('parseCustomDate 健壮性', () => {
  it('非日期文本 / 纯数字 / 控制字符 / 超长输入均返回 null 而不抛错', () => {
    const texts = [
      '',
      '   ',
      '随便写点什么',
      '12345',
      '1.5',
      '+100',
      '1e10',
      '0x10',
      '\u0000',
      'a'.repeat(5000),
    ]
    for (const text of texts) {
      expect(() => parseCustomDate(text), text).not.toThrow()
      expect(parseCustomDate(text), text).toBeNull()
    }
  })

  it('越界数字本身（非日期串）不会误判为时间戳', () => {
    expect(parseCustomDate('99999999999999999999')).toBeNull()
  })
})

describe('parseStamp 数字识别', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('10 位及以下按 Unix 秒，11 位及以上按 Unix 毫秒', () => {
    const secs = parseStamp('1780000000')
    expect(secs.ok).toBe(true)
    if (!secs.ok) return
    expect(secs.source).toBe('secs')
    expect(secs.rows[0].value).toBe('1780000000')
    expect(secs.rows[1].value).toBe('1780000000000')

    const tenDigits = parseStamp('9999999999')
    expect(tenDigits.ok).toBe(true)
    if (tenDigits.ok) expect(tenDigits.source).toBe('secs')

    const elevenDigits = parseStamp('10000000000')
    expect(elevenDigits.ok).toBe(true)
    if (elevenDigits.ok) {
      expect(elevenDigits.source).toBe('ms')
      expect(elevenDigits.rows[0].value).toBe('10000000000'.slice(0, -3))
      expect(elevenDigits.rows[1].value).toBe('10000000000')
    }
  })

  it('前导零按位数判定位数：10 个零是秒，11 个零是毫秒', () => {
    const tenZeros = parseStamp('0000000000')
    expect(tenZeros.ok).toBe(true)
    if (tenZeros.ok) {
      expect(tenZeros.source).toBe('secs')
      expect(tenZeros.rows[0].value).toBe('0')
    }

    const elevenZeros = parseStamp('00000000000')
    expect(elevenZeros.ok).toBe(true)
    if (elevenZeros.ok) {
      expect(elevenZeros.source).toBe('ms')
      expect(elevenZeros.rows[1].value).toBe('0')
    }
  })

  it('负时间戳按去掉负号后的位数判定秒 / 毫秒，1970 以前不误判', () => {
    const secs = parseStamp('-1000000000')
    expect(secs.ok).toBe(true)
    if (!secs.ok) return
    expect(secs.source).toBe('secs')
    expect(secs.rows[0].value).toBe('-1000000000')
    expect(secs.rows[1].value).toBe('-1000000000000')

    const ms = parseStamp('-1000000000000')
    expect(ms.ok).toBe(true)
    if (!ms.ok) return
    expect(ms.source).toBe('ms')
    expect(ms.rows[1].value).toBe('-1000000000000')
  })

  it('-1 / -0 的符号与单位判定', () => {
    const minusOne = parseStamp('-1')
    expect(minusOne.ok).toBe(true)
    if (minusOne.ok) {
      expect(minusOne.source).toBe('secs')
      expect(minusOne.rows[1].value).toBe('-1000')
    }

    const minusZero = parseStamp('-0')
    expect(minusZero.ok).toBe(true)
    if (minusZero.ok) {
      expect(minusZero.source).toBe('secs')
      expect(minusZero.rows[0].value).toBe('0')
    }
  })

  it('超出 Date 范围返回 ok:false 而不抛错', () => {
    const huge = '99999999999999999999' // 20 位
    expect(() => parseStamp(huge)).not.toThrow()
    expect(parseStamp(huge)).toEqual({ ok: false })
    expect(parseStamp('8640000000000001')).toEqual({ ok: false }) // 超过 ±8.64e15 ms
  })

  it('Date 上限边界（8.64e15 ms）仍可解析并输出扩展年份', () => {
    const res = parseStamp('8640000000000000')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.source).toBe('ms')
    expect(res.rows[2].value).toBe('+275760-09-13T00:00:00.000Z')
    expect(res.rows[4].value).toContain('275760')
  })

  it('非整数 / 带正号 / 科学计数 / 十六进制 / 全角数字不当作时间戳', () => {
    for (const text of ['1.5', '+100', '1e10', '0x10', '１２３', '1 000']) {
      expect(parseStamp(text), text).toEqual({ ok: false })
    }
  })

  it('前后空白被忽略', () => {
    const res = parseStamp('  1780000000  ')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.rows[0].value).toBe('1780000000')
  })

  it('空串与纯空白返回 ok:false', () => {
    expect(parseStamp('')).toEqual({ ok: false })
    expect(parseStamp('   ')).toEqual({ ok: false })
  })
})

describe('parseStamp 日期文本与结果行', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('日期文本走 text 分支，固定 6 行且标签为中文', () => {
    const res = parseStamp('2025-01-01 00:00:00')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.source).toBe('text')
    expect(res.rows.map((r) => r.label)).toEqual([
      'Unix 秒',
      'Unix 毫秒',
      'ISO 8601',
      '本地时间',
      'UTC 时间',
      '相对现在',
    ])
    expect(res.rows.every((r) => r.value.length > 0)).toBe(true)
  })

  it('结果行与 Date 的字段一一对应（秒 / 毫秒 / ISO / 本地 / UTC / 相对）', () => {
    const d = new Date(2025, 0, 2, 3, 4, 5)
    const res = parseStamp(toLocalText(d))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rows[0].value).toBe(String(Math.floor(d.getTime() / 1000)))
    expect(res.rows[1].value).toBe(String(d.getTime()))
    expect(res.rows[2].value).toBe(d.toISOString())
    expect(res.rows[3].value).toBe(toLocalText(d))
    expect(res.rows[4].value).toBe(d.toUTCString())
    expect(res.rows[5].value).toBe(toRelative(d))
  })

  it('日期文本往返：toLocalText → parseStamp 得到同一毫秒（毫秒已被截断）', () => {
    const d = new Date(2025, 5, 15, 12, 30, 45)
    const res = parseStamp(toLocalText(d))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.rows[1].value).toBe(String(d.getTime()))
  })

  it('毫秒时间戳与等值日期文本得到相同的 ISO 行', () => {
    const d = new Date(2025, 5, 15, 12, 30, 45)
    const fromMs = parseStamp(String(d.getTime()))
    const fromText = parseStamp(toLocalText(d))
    expect(fromMs.ok && fromText.ok).toBe(true)
    if (fromMs.ok && fromText.ok) {
      expect(fromMs.source).toBe('ms')
      expect(fromMs.rows[2].value).toBe(fromText.rows[2].value)
    }
  })

  it('闰年 2 月 29 日可解析，平年 / 百年不闰不可解析', () => {
    expect(parseStamp('2024/02/29 00:00:00').ok).toBe(true)
    expect(parseStamp('2023-02-29 00:00:00').ok).toBe(false)
    expect(parseStamp('2100/02/29 00:00:00').ok).toBe(false)
  })

  it('带 Z / 时区偏移的日期文本按绝对时间解析（不受运行环境时区影响）', () => {
    const res = parseStamp('2025-03-09T07:00:00Z')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.source).toBe('text')
    expect(res.rows[0].value).toBe(String(Date.UTC(2025, 2, 9, 7, 0, 0) / 1000))
    expect(res.rows[2].value).toBe('2025-03-09T07:00:00.000Z')
  })

  it('无法识别的文本返回 ok:false（结果对象无 error 字段）', () => {
    expect(parseStamp('随便写点什么')).toEqual({ ok: false })
    expect(parseStamp('Debian GNU/Linux 12 (bookworm)')).toEqual({ ok: false })
    expect(parseStamp('2025年13月1日')).toEqual({ ok: false })
  })
})

describe('timestamp 文案 i18n（中英双语）', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('英文界面下结果行标签与相对时间不含中文', async () => {
    await i18n.changeLanguage('en')

    expect(toRelative(new Date())).toBe('Just now')
    expect(toRelative(new Date(Date.now() + 5 * 86_400_000))).toBe('in 5 d')
    expect(toRelative(new Date(Date.now() - 5 * 60_000))).toBe('5 min ago')

    const res = parseStamp('1780000000')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rows.map((r) => r.label)).toEqual([
      'Unix seconds',
      'Unix milliseconds',
      'ISO 8601',
      'Local time',
      'UTC time',
      'Relative to now',
    ])
    for (const row of res.rows) {
      expect(CJK.test(row.label), row.label).toBe(false)
      expect(CJK.test(row.value), row.value).toBe(false)
    }
  })

  it('中文界面下同一批文案均为中文', async () => {
    await i18n.changeLanguage('zh')

    expect(CJK.test(toRelative(new Date(Date.now() + 5 * 86_400_000)))).toBe(true)
    expect(CJK.test(toRelative(new Date()))).toBe(true)

    const res = parseStamp('1780000000')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rows.map((r) => r.label)).toEqual([
      'Unix 秒',
      'Unix 毫秒',
      'ISO 8601',
      '本地时间',
      'UTC 时间',
      '相对现在',
    ])
    expect(CJK.test(res.rows[5].value)).toBe(true)
  })
})
