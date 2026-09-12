import { afterAll, describe, expect, it } from 'vitest'

import i18n from '@/i18n'

import { detect } from './detect'
import type { DetectResult } from './detect'

/** 以「字段 key → 值」取出短字段，便于逐项断言 */
function fieldMap(res: DetectResult | null): Record<string, string> {
  return Object.fromEntries((res?.fields ?? []).map((f) => [f.key, f.value]))
}

/** 断言识别类型；识别失败直接抛错，避免后续断言在 null 上静默通过 */
function expectKind(input: string, kind: string): DetectResult {
  const res = detect(input)
  if (!res) throw new Error(`detect(${JSON.stringify(input)}) 应识别出结果，实际为 null`)
  expect(res.kind).toBe(kind)
  return res
}

/** 取所有候选项的类型，用于记录混合场景 */
function kindsOf(res: DetectResult | null): string[] {
  return (res?.items ?? []).map((i) => i.kind)
}

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeToken(header: unknown, payload: unknown, signature = 'c2ln'): string {
  return `${b64url(header)}.${b64url(payload)}.${signature}`
}

const CJK_RE = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

describe('detect：纯净单目标（整段即目标，不产生高亮区间）', () => {
  it.each([
    ['SGVsbG8gV29ybGQ=', 'base64'],
    ['{"a":1}', 'json'],
    ['https://example.com/a', 'url'],
    ['1780000000', 'timestamp'],
    ['550e8400-e29b-41d4-a716-446655440000', 'uuid'],
    ['deadbeef', 'hex'],
    ['data:image/png;base64,iVBORw0KGgo=', 'dataurl'],
  ])('%s 识别为 %s 且 sourceMatches 为 undefined', (input, kind) => {
    const res = expectKind(input, kind)
    // 整段就是目标时没有可高亮的子串，避免输入框把整段标红
    expect(res.sourceMatches).toBeUndefined()
    expect(res.items).toBeUndefined()
  })

  it('前后空白会被 trim 后再判定，copy 取规范化结果', () => {
    const res = expectKind('  https://example.com/a  ', 'url')
    expect(res.copy).toBe('https://example.com/a')
    expect(res.fields).toEqual([{ key: 'url', value: 'https://example.com/a', mono: true }])
  })
})

describe('detect：JSON / JSONC', () => {
  it('对象输出「格式化 + 压缩」两份内容，copy 取格式化文本', () => {
    const res = expectKind('{"a":1}', 'json')
    expect(res.fields).toEqual([])
    expect(res.blocks).toEqual([
      {
        key: 'parsed',
        value: '{\n  "a": 1\n}',
        formattedValue: '{\n  "a": 1\n}',
        minifiedValue: '{"a":1}',
        json: true,
      },
    ])
    expect(res.copy).toBe('{\n  "a": 1\n}')
  })

  it('数组与嵌套结构按两空格缩进展开', () => {
    expect(expectKind('[1,2]', 'json').copy).toBe('[\n  1,\n  2\n]')
    expect(expectKind('[[1,2],[3]]', 'json').copy).toBe(
      '[\n  [\n    1,\n    2\n  ],\n  [\n    3\n  ]\n]',
    )
  })

  it('空对象 / 空数组是合法 JSON', () => {
    expect(expectKind('{}', 'json').copy).toBe('{}')
    expect(expectKind('[]', 'json').copy).toBe('[]')
  })

  it('允许尾随逗号（jsonc-parser 的宽松解析）', () => {
    expect(expectKind('{"a":1,}', 'json').copy).toBe('{\n  "a": 1\n}')
    expect(expectKind('["a",]', 'json').copy).toBe('[\n  "a"\n]')
  })

  it('外层空白不影响识别', () => {
    expect(expectKind(' \n { "b" : [1] } \n ', 'json').copy).toBe('{\n  "b": [\n    1\n  ]\n}')
  })

  it('Unicode 键值原样保留（不转义为 \\uXXXX）', () => {
    expect(expectKind('{"名":"值😀"}', 'json').copy).toBe('{\n  "名": "值😀"\n}')
  })

  it.each(['{bad}', '{"a":}', '{"a":1} extra', '["a"', '{"a" 1}', 'NaN'])(
    '%s 不是合法 JSON，且不应被其它类型误判',
    (input) => {
      expect(detect(input)).toBeNull()
    },
  )

  it('仅有 { / [ 开头才进入 JSON 分支：前置注释的 JSONC 不识别（现状记录）', () => {
    // formatJson 本身支持注释，但 detectJson 的 isJsonLike 只认首字符，属于源码疑点
    expect(detect('// note\n{"a":1}')).toBeNull()
  })
})

describe('detect：JWT', () => {
  const token = makeToken(
    { alg: 'HS256', typ: 'JWT' },
    { sub: '123', name: 'Panda', iat: 1516239022 },
  )

  it('解码 header / payload / signature 三段并给出算法与声明字段', () => {
    const res = expectKind(token, 'jwt')
    expect(res.fields.map((f) => f.key)).toEqual(['algorithm', 'claim.sub', 'claim.iat'])
    const fm = fieldMap(res)
    expect(fm.algorithm).toBe('HS256')
    expect(fm['claim.sub']).toBe('123')
    expect(res.blocks.map((b) => b.key)).toEqual(['header', 'payload', 'signature'])
    expect(res.blocks[0]).toMatchObject({
      value: JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2),
      json: true,
    })
    expect(res.blocks[2].value).toBe('c2ln')
    expect(res.copy).toBe(res.blocks[1].value)
  })

  it('日期声明（iat/exp）显示为本地日期时间', () => {
    const res = expectKind(token, 'jwt')
    expect(fieldMap(res)['claim.iat']).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('自动清洗 Bearer 前缀（大小写不敏感、多空格、首尾空白）', () => {
    expect(expectKind(`Bearer ${token}`, 'jwt').copy).toBe(expectKind(token, 'jwt').copy)
    expect(expectKind(`bearer   ${token}`, 'jwt').kind).toBe('jwt')
    expect(expectKind(`  ${token}  `, 'jwt').kind).toBe('jwt')
  })

  it('header 缺少 alg 时回退到「未知算法」文案（字段仍存在且非空）', () => {
    const res = expectKind(makeToken({}, { a: 1 }), 'jwt')
    expect(res.fields[0].key).toBe('algorithm')
    expect(res.fields[0].value.length).toBeGreaterThan(0)
  })

  it('payload 非对象 / 为空对象时不产生声明字段，但仍是合法 JWT', () => {
    expect(expectKind(makeToken({ alg: 'none' }, [1, 2]), 'jwt').fields.map((f) => f.key)).toEqual([
      'algorithm',
    ])
    expect(expectKind(makeToken({ alg: 'none' }, {}), 'jwt').fields.map((f) => f.key)).toEqual([
      'algorithm',
    ])
  })

  it('段数不为 3 或段内非法字符时不会识别为 JWT', () => {
    expect(detect('a.b')?.kind).not.toBe('jwt')
    expect(detect('a..c')?.kind).not.toBe('jwt')
    expect(detect('a$b.c.d')?.kind).not.toBe('jwt')
  })

  it('两段式 token 会被裸域名规则误判为 URL（现状记录，源码疑点）', () => {
    const res = detect('eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ')
    expect(res?.kind).not.toBe('jwt')
    expect(res?.kind).toBe('url')
    expect(res?.copy).toBe('https://eyjhbgcioijiuzi1nij9.eyjhijoxfq/')
  })

  it('payload 不是 JSON 时三段式 token 降级为 URL（现状记录，源码疑点）', () => {
    const res = detect('eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.c2ln')
    expect(res?.kind).not.toBe('jwt')
    expect(res?.kind).toBe('url')
  })
})

describe('detect：URL', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com/'],
    ['ftp://example.com/x', 'ftp://example.com/x'],
    ['ws://a.com', 'ws://a.com/'],
    ['wss://example.com/socket', 'wss://example.com/socket'],
    ['file:///tmp/a', 'file:///tmp/a'],
  ])('%s 识别为 URL 并规范化为 %s', (input, href) => {
    const res = expectKind(input, 'url')
    expect(res.copy).toBe(href)
    expect(res.blocks).toEqual([])
  })

  it('裸域名自动补 https，并保留端口 / 路径 / 查询 / hash', () => {
    expect(expectKind('example.com', 'url').copy).toBe('https://example.com/')
    expect(expectKind('www.example.com/path?q=1#h', 'url').copy).toBe(
      'https://www.example.com/path?q=1#h',
    )
  })

  it('localhost 与 IPv4 自动补 http', () => {
    expect(expectKind('localhost:3000/a', 'url').copy).toBe('http://localhost:3000/a')
    expect(expectKind('192.168.1.1', 'url').copy).toBe('http://192.168.1.1/')
    expect(expectKind('192.168.1.1:8080/path', 'url').copy).toBe('http://192.168.1.1:8080/path')
    expect(expectKind('1.2.3.4', 'url').copy).toBe('http://1.2.3.4/')
  })

  it('带协议的 IPv6 主机正常识别', () => {
    expect(expectKind('http://[::1]:8080/', 'url').copy).toBe('http://[::1]:8080/')
  })

  it.each([
    'javascript:alert(1)',
    'mailto:a@b.com',
    'https://example.com:99999/',
    'http://',
    '256.1.1.1',
    '://x',
  ])('%s 不是受支持协议或主机非法，不应识别为 URL', (input) => {
    expect(detect(input)).toBeNull()
  })

  it('单个 URL 含空白时按多段文本处理（交给逐条提取）', () => {
    // detectUrl 明确要求单个 URL 内不含空白，否则会把两行相同网址合并解析
    const res = detect('https://a.com https://b.com')
    expect(res?.kind).toBe('url')
    expect(res?.items).toHaveLength(2)
  })

  it('尾部标点被剥离出 URL，但高亮区间仍覆盖原文那一段', () => {
    const input = 'see https://example.com/a.'
    const res = expectKind(input, 'url')
    expect(res.copy).toBe('https://example.com/a')
    expect(res.sourceMatches?.[0]).toEqual({
      text: 'https://example.com/a',
      startIndex: 4,
      endIndex: 26,
      active: true,
    })
    // 区间右端多包住了一个 '.'：normalizeUrl 的清洗不回写偏移
    expect(input.slice(4, 26)).toBe('https://example.com/a.')
  })

  it('括号包裹的 URL 会剥掉右括号，区间同样按原始匹配长度计算', () => {
    const input = '(https://example.com/a)'
    const res = expectKind(input, 'url')
    expect(res.copy).toBe('https://example.com/a')
    expect(res.sourceMatches?.[0].startIndex).toBe(1)
    expect(input.slice(1, 23)).toBe('https://example.com/a)')
  })

  it('CJK 字符作为 URL 边界被排除，不会吞掉后文', () => {
    const input = '你好，https://example.com/中文'
    const res = expectKind(input, 'url')
    expect(res.copy).toBe('https://example.com/')
    expect(res.sourceMatches?.[0]).toEqual({
      text: 'https://example.com/',
      startIndex: 3,
      endIndex: 23,
      active: true,
    })
  })
})

describe('detect：多 URL 提取与去重', () => {
  it('两个带协议 URL 各自成为一项，按出现顺序排列', () => {
    const input = 'https://a.com https://b.com'
    const res = detect(input)
    expect(res?.items).toHaveLength(2)
    expect(res?.items?.map((i) => i.copy)).toEqual(['https://a.com/', 'https://b.com/'])
    expect(res?.copy).toBe('https://a.com/')
  })

  it('裸域名若是带协议 URL 的一部分则不重复计一次', () => {
    const res = detect('看 https://a.com 好')
    expect(res?.items).toHaveLength(1)
    expect(res?.items?.[0].copy).toBe('https://a.com/')
  })

  it('detect 从不产出 kind="urls"（该类型只存在于类型定义中）', () => {
    const res = detect('https://a.com https://b.com')
    expect(res?.kind).toBe('url')
    expect(kindsOf(res)).toEqual(['url', 'url'])
  })
})

describe('detect：时间戳（秒 / 毫秒 / 日期文本）', () => {
  /** seconds / milliseconds / iso 与输入强相关，可跨时区断言；date/utc 只做格式与自洽校验 */
  function expectStamp(res: DetectResult, seconds: string, milliseconds: string, iso: string) {
    expect(res.fields.map((f) => f.key)).toEqual([
      'seconds',
      'milliseconds',
      'iso',
      'date',
      'utc',
      'relative',
    ])
    const fm = fieldMap(res)
    expect(fm.seconds).toBe(seconds)
    expect(fm.milliseconds).toBe(milliseconds)
    expect(fm.iso).toBe(iso)
    expect(fm.date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(fm.utc).toMatch(/GMT$/)
    expect(fm.relative.length).toBeGreaterThan(0)
    // 本地时间必须与毫秒值属于同一年，避免依赖运行环境时区做硬编码
    expect(fm.date.slice(0, 4)).toBe(String(new Date(Number(fm.milliseconds)).getFullYear()))
  }

  it('10 位纯数字按「秒」解释', () => {
    expectStamp(
      expectKind('1710000000', 'timestamp'),
      '1710000000',
      '1710000000000',
      '2024-03-09T16:00:00.000Z',
    )
  })

  it('9 位纯数字是秒的下边界', () => {
    expectStamp(
      expectKind('999999999', 'timestamp'),
      '999999999',
      '999999999000',
      '2001-09-09T01:46:39.000Z',
    )
  })

  it('13 位纯数字按「毫秒」解释', () => {
    expectStamp(
      expectKind('1710000000000', 'timestamp'),
      '1710000000',
      '1710000000000',
      '2024-03-09T16:00:00.000Z',
    )
  })

  it('11 / 12 位纯数字（>10 位）走毫秒分支', () => {
    const eleven = expectKind('12345678901', 'timestamp')
    expect(fieldMap(eleven)).toMatchObject({ seconds: '12345678', milliseconds: '12345678901' })
    const twelve = expectKind('100000000000', 'timestamp')
    expect(fieldMap(twelve)).toMatchObject({ seconds: '100000000', milliseconds: '100000000000' })
  })

  it('负时间戳按秒解释（1970 之前）', () => {
    const res = expectKind('-1000000000', 'timestamp')
    expect(fieldMap(res)).toMatchObject({
      seconds: '-1000000000',
      milliseconds: '-1000000000000',
    })
  })

  it('前导零不改变数值：9 个 0 解析为 epoch', () => {
    expectStamp(expectKind('000000000', 'timestamp'), '0', '0', '1970-01-01T00:00:00.000Z')
  })

  it.each(['200', '2025', '8080', '0', '12'])('%s 普通短数字不判为时间戳', (input) => {
    expect(detect(input)).toBeNull()
  })

  it('8 位纯数字不判为时间戳（<9 位），但会落到 hex 分支', () => {
    // 现状记录：8 位十六进制形态的数字会被 detectHex 接住，并非「什么都不识别」
    expect(detect('99999999')?.kind).not.toBe('timestamp')
    expect(detect('12345678')?.kind).toBe('hex')
  })

  it('16 位纯数字超出年份上限（>2200），不会判为时间戳', () => {
    expect(detect('1710000000000000')?.kind).not.toBe('timestamp')
    expect(detect('1710000000000000')?.kind).toBe('hex')
  })

  it('17 位纯数字直接拒绝（长度守卫）', () => {
    expect(detect('10000000000000000')).toBeNull()
  })

  it.each(['2025-13-01', '2025-02-30', '2025年13月1日', '2025-00-10'])(
    '%s 日期非法（月份/日期越界或回滚）时不识别',
    (input) => {
      expect(detect(input)).toBeNull()
    },
  )

  it('英文月份日期的年份上下界：1899 / 2201 拒绝，2200 接受', () => {
    // 这些输入按本地时间解析，年份判定与时区无关，可比「1900 GMT」更稳地覆盖边界
    expect(detect('Jan 01, 1899')).toBeNull()
    expect(detect('Jan 01, 2201')).toBeNull()
    expect(expectKind('Jan 01, 2200', 'timestamp').kind).toBe('timestamp')
    expect(detect('Mon, 01 Jan 1899 00:00:00 GMT')).toBeNull()
  })

  it('YYYY-MM-DD 是 date-only（按 UTC 解析），但年份校验用本地日历：负偏移时区会被拒识（现状记录，源码疑点）', () => {
    const utcMidnight = new Date('2025-01-01')
    const sameLocalDate =
      utcMidnight.getFullYear() === 2025 &&
      utcMidnight.getMonth() === 0 &&
      utcMidnight.getDate() === 1
    const res = detect('2025-01-01')
    if (!sameLocalDate) {
      // 如 America/New_York：本地日历回退到 2024-12-31，parseCustomDate 的本地年月日校验因此判为非法
      expect(res).toBeNull()
      return
    }
    expect(fieldMap(res)).toMatchObject({
      seconds: '1735689600',
      milliseconds: '1735689600000',
      iso: '2025-01-01T00:00:00.000Z',
    })
  })

  it('点分隔日期被规范化为年-月-日，行为与 YYYY-MM-DD 完全一致', () => {
    const utcMidnight = new Date('2025-01-01')
    const sameLocalDate =
      utcMidnight.getFullYear() === 2025 &&
      utcMidnight.getMonth() === 0 &&
      utcMidnight.getDate() === 1
    const res = detect('2025.01.01')
    if (!sameLocalDate) {
      expect(res).toBeNull()
      return
    }
    expect(fieldMap(res)).toMatchObject({ iso: '2025-01-01T00:00:00.000Z' })
  })

  it('斜杠日期按本地时间解析', () => {
    const res = expectKind('2025/01/01', 'timestamp')
    expect(fieldMap(res).seconds).toBe(String(Math.floor(new Date('2025/01/01').getTime() / 1000)))
  })

  it('YYYY-MM-DD HH:mm:ss 与带 Z 的 ISO 时间', () => {
    const localText = expectKind('2025-01-01 15:30:00', 'timestamp')
    expect(fieldMap(localText).seconds).toBe(
      String(Math.floor(new Date(2025, 0, 1, 15, 30, 0).getTime() / 1000)),
    )
    const zulu = expectKind('2025-01-01T15:30:00Z', 'timestamp')
    expect(fieldMap(zulu).iso).toBe('2025-01-01T15:30:00.000Z')
  })

  it('中文年月日（含「15点30分」「15:30」等时间写法）', () => {
    const dateOnly = expectKind('2025年1月1日', 'timestamp')
    expect(fieldMap(dateOnly).seconds).toBe(
      String(Math.floor(new Date(2025, 0, 1).getTime() / 1000)),
    )
    const cnTime = expectKind('2025年1月1日 15点30分', 'timestamp')
    expect(fieldMap(cnTime).seconds).toBe(
      String(Math.floor(new Date(2025, 0, 1, 15, 30, 0).getTime() / 1000)),
    )
    const cnColon = expectKind('2025年1月1日 15:30:20', 'timestamp')
    expect(fieldMap(cnColon).seconds).toBe(
      String(Math.floor(new Date(2025, 0, 1, 15, 30, 20).getTime() / 1000)),
    )
  })

  it('混合格式 2025-01-01 15点30分 按本地时间解析', () => {
    expect(fieldMap(expectKind('2025-01-01 15点30分', 'timestamp')).seconds).toBe(
      String(Math.floor(new Date(2025, 0, 1, 15, 30, 0).getTime() / 1000)),
    )
  })

  it('英文月份日期（RFC 2822 / HTTP Date）', () => {
    const en = expectKind('Jan 01, 2025', 'timestamp')
    expect(fieldMap(en).seconds).toBe(String(Math.floor(new Date('Jan 01, 2025').getTime() / 1000)))
    const http = expectKind('Wed, 01 Jan 2025 00:00:00 GMT', 'timestamp')
    expect(fieldMap(http).iso).toBe('2025-01-01T00:00:00.000Z')
    expect(expectKind('Dec 31, 1999', 'timestamp').kind).toBe('timestamp')
  })

  it('中文日期夹在句子中间也能挖出并给出精确区间', () => {
    const input = '会议时间2025年1月1日15点30分开始'
    const res = detect(input)
    expect(res?.kind).toBe('timestamp')
    expect(res?.items).toHaveLength(1)
    expect(res?.sourceMatches?.[0]).toEqual({
      text: '2025年1月1日15点30分',
      startIndex: 4,
      endIndex: 19,
      active: true,
    })
  })

  it('句子中的 10 位 / 13 位时间戳分别作为独立候选项', () => {
    const res = detect('id 1710000000 and 1710000000000')
    expect(res?.items).toHaveLength(2)
    expect(res?.sourceMatches).toEqual([
      { text: '1710000000', startIndex: 3, endIndex: 13, active: true },
      { text: '1710000000000', startIndex: 18, endIndex: 31, active: false },
    ])
  })

  it('句子中的标准日期被挖出（用斜杠写法保证本地解析、跨时区稳定）', () => {
    const res = detect('on 2025/01/01 good')
    expect(res?.kind).toBe('timestamp')
    expect(res?.sourceMatches?.[0]).toEqual({
      text: '2025/01/01',
      startIndex: 3,
      endIndex: 13,
      active: true,
    })
  })
})

describe('detect：UUID', () => {
  it('v1~v5 均识别，并给出版本与有效标记', () => {
    for (const version of ['1', '2', '3', '4', '5']) {
      const input = `550e8400-e29b-${version}1d4-a716-446655440000`
      const res = expectKind(input, 'uuid')
      expect(res.fields).toEqual([
        { key: 'valid', value: '✓' },
        { key: 'version', value: `v${version}` },
      ])
      expect(res.copy).toBe(input)
      expect(res.blocks).toEqual([])
    }
  })

  it('大写 UUID 同样识别（正则大小写不敏感）', () => {
    const res = expectKind('550E8400-E29B-41D4-A716-446655440000', 'uuid')
    expect(fieldMap(res).version).toBe('v4')
  })

  it('variant 段不是 8/9/a/b 时不算 UUID', () => {
    expect(detect('550e8400-e29b-41d4-c716-446655440000')?.kind).not.toBe('uuid')
  })

  it('v6/v7（正则只允许 [1-5]）不被识别为 UUID，会退化到 hex 候选（现状记录）', () => {
    const v6 = detect('550e8400-e29b-61d4-b716-446655440000')
    expect(v6?.kind).not.toBe('uuid')
    expect(v6?.kind).toBe('hex')
    const v7 = detect('018f6b1e-9c1a-7c3b-8b4d-2f1e3a4b5c6d')
    expect(v7?.kind).not.toBe('uuid')
  })

  it('夹在文本中的 UUID 目前不会被识别为 uuid（现状记录，源码疑点）', () => {
    const res = detect('ID:550e8400-e29b-41d4-a716-446655440000 好')
    expect(res?.kind).not.toBe('uuid')
    expect(kindsOf(res)).toContain('hex')
  })
})

describe('detect：Base64', () => {
  it.each([
    ['YQ==', 'a'],
    ['YWI=', 'ab'],
    ['YWJj', 'abc'],
    ['aGk=', 'hi'],
    ['YWFh', 'aaa'],
    ['5L2g', '你'],
    ['5aW9', '好'],
    ['5L2g5aW9', '你好'],
    ['5L2g5aW95LiW55WM', '你好世界'],
    ['SGVsbG8gV29ybGQ=', 'Hello World'],
    ['YWFhYWFhYQ==', 'aaaaaaa'],
    [
      'SGVsbG8sIFBhbmRhIERvY2shIFdlbGNvbWUgdG8gdGhlIHRvb2xraXQu',
      'Hello, Panda Dock! Welcome to the toolkit.',
    ],
  ])('%s 解码为 %s', (input, expected) => {
    const res = expectKind(input, 'base64')
    expect(res.copy).toBe(expected)
    expect(res.fields).toEqual([])
    expect(res.blocks[0]).toMatchObject({
      key: 'decoded',
      value: expected,
      formattedValue: expected,
    })
  })

  it('解出 JSON 时改用 parsed 块并附带压缩版本', () => {
    const res = expectKind('eyJhIjoxfQ==', 'base64')
    expect(res.blocks[0]).toMatchObject({
      key: 'parsed',
      value: '{\n  "a": 1\n}',
      formattedValue: '{\n  "a": 1\n}',
      minifiedValue: '{"a":1}',
      json: true,
    })
    expect(res.copy).toBe('{\n  "a": 1\n}')
  })

  it('解出「带外层空白的 JSON」同样按 JSON 展示', () => {
    const encoded = btoa('  {"a":1}  ')
    const res = expectKind(encoded, 'base64')
    expect(res.blocks[0].key).toBe('parsed')
    expect(res.copy).toBe('{\n  "a": 1\n}')
  })

  it('换行分隔的 Base64 仍可解码（只拒绝空格与制表符）', () => {
    expect(expectKind('SGVsbG8g\nV29ybGQ=', 'base64').copy).toBe('Hello World')
    expect(expectKind('SGVsbG8g\r\nV29ybGQ=', 'base64').copy).toBe('Hello World')
  })

  it.each(['SGVs bG8=', 'SGVs\tbG8='])('%j 含空格/制表符，按普通分词文本拒绝', (input) => {
    expect(detect(input)).toBeNull()
  })

  it('二进制文件：命中 PNG 魔数时给出预览块与可下载信息', () => {
    const res = expectKind('iVBORw0KGgo=', 'base64')
    expect(res.fields).toEqual([{ key: 'bytes', value: '8 B', mono: true }])
    expect(res.blocks).toEqual([
      { key: 'image', value: 'data:image/png;base64,iVBORw0KGgo=', image: true },
    ])
    expect(res.download).toEqual({
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      sizeBytes: 8,
    })
    expect(res.copy).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('二进制文件：非图片魔数（7z）不产生预览块，但仍可下载', () => {
    // 0xBC / 0xAF 是 UTF-8 连续字节，解码必然失败，从而进入魔数识别分支
    const binary = btoa(String.fromCharCode(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c))
    const res = expectKind(binary, 'base64')
    expect(res.fields).toEqual([{ key: 'bytes', value: '6 B', mono: true }])
    expect(res.blocks).toEqual([])
    expect(res.download).toEqual({
      mime: 'application/x-7z-compressed',
      dataUrl: `data:application/x-7z-compressed;base64,${binary}`,
      sizeBytes: 6,
    })
  })

  it('能解出合法 UTF-8 就一定当文本，即使包含非 ASCII（不做魔数猜测）', () => {
    expect(expectKind('5L2g5aW9', 'base64').blocks).toHaveLength(1)
  })

  it.each(['qwertyui', 'zzzzzzzz'])('%s 解出未知二进制且无魔数，不识别', (input) => {
    expect(detect(input)).toBeNull()
  })

  it.each(['AQID', 'AAAA'])('%s 解出的文本含不可见控制字符，拒绝', (input) => {
    expect(detect(input)).toBeNull()
  })

  it('解出的文本含制表符属于可打印文本，仍识别', () => {
    expect(expectKind(btoa('a\tb'), 'base64').copy).toBe('a\tb')
  })

  it.each(['eyJhIjoxfQ', 'YQ=', 'YQ===', '====', 'SGVsbG8gV29ybGQ==', 'aGVsbG8td29ybGQ'])(
    '%s 长度/字符集非法，不识别为 Base64',
    (input) => {
      expect(detect(input)).toBeNull()
    },
  )

  it.each(['file', 'edit', 'aced', 'dead', 'beef', 'cafe', 'word', 'test'])(
    '%s 是 4 字符纯小写英文单词，按误判护栏拒绝',
    (input) => {
      expect(detect(input)).toBeNull()
    },
  )

  it.each(['【SGVsbG8gV29ybGQ=】', '<SGVsbG8gV29ybGQ=>', '"SGVsbG8gV29ybGQ="'])(
    '%s 的包裹符号被剥离后命中，且区间只覆盖载荷',
    (input) => {
      const res = expectKind(input, 'base64')
      expect(res.copy).toBe('Hello World')
      expect(res.sourceMatches?.[0]).toMatchObject({
        text: 'SGVsbG8gV29ybGQ=',
        startIndex: input.indexOf('SGVsbG8gV29ybGQ='),
        endIndex: input.indexOf('SGVsbG8gV29ybGQ=') + 16,
        active: true,
      })
    },
  )
})

describe('detect：Hex', () => {
  it('连续 hex 解出可打印 ASCII', () => {
    const res = expectKind('48656c6c6f', 'hex')
    expect(res.fields).toEqual([{ key: 'bytes', value: '5 B', mono: true }])
    expect(res.blocks).toEqual([{ key: 'decoded', value: 'Hello' }])
    expect(res.copy).toBe('Hello')
  })

  it('大写 hex 与 0x / 0X 前缀同样支持', () => {
    expect(expectKind('48656C6C6F', 'hex').copy).toBe('Hello')
    expect(expectKind('0x48656c6c6f', 'hex').copy).toBe('Hello')
    expect(expectKind('0X48656C6C6F', 'hex').copy).toBe('Hello')
  })

  it('空白（空格/换行/制表）被整体剔除后再解析', () => {
    expect(expectKind('48 65 6c 6c 6f', 'hex').copy).toBe('Hello')
    expect(expectKind('48 65\n6c 6c\t6f', 'hex').copy).toBe('Hello')
    expect(expectKind('48 65 6c 6c 6f 2c 20 50 61 6e 64 61 20 44 6f 63 6b 21', 'hex').copy).toBe(
      'Hello, Panda Dock!',
    )
  })

  it('不可打印字节显示为 ·，可打印字符原样保留', () => {
    expect(expectKind('deadbeef', 'hex').copy).toBe('····')
    expect(expectKind('41ff4243', 'hex').copy).toBe('A·BC')
  })

  it.each(['abcdef', 'abcdefa', 'abcdefabc', 'zzzzzzzz', 'gg123456'])(
    '%s 长度不足或含非 hex 字符，不识别',
    (input) => {
      expect(detect(input)).toBeNull()
    },
  )

  it('MD5 / SHA-1 / SHA-256 十六进制摘要都归入 hex（detect 没有独立的 hash 类型）', () => {
    const md5Hex = '900150983cd24fb0d6963f7d28e17f72'
    const sha1Hex = 'a9993e364706816aba3e25717850c26c9cd0d89d'
    const sha256Hex = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(fieldMap(expectKind(md5Hex, 'hex')).bytes).toBe('16 B')
    expect(fieldMap(expectKind(sha1Hex, 'hex')).bytes).toBe('20 B')
    expect(fieldMap(expectKind(sha256Hex, 'hex')).bytes).toBe('32 B')
    expect(fieldMap(expectKind(md5Hex.toUpperCase(), 'hex')).bytes).toBe('16 B')
  })

  it('带 # 的 8 位颜色码会被当作 hex 载荷（现状记录）', () => {
    const res = detect('#AABBCCDD')
    expect(res?.kind).toBe('hex')
    expect(res?.sourceMatches?.[0]).toMatchObject({ text: 'AABBCCDD', startIndex: 1, endIndex: 9 })
  })
})

describe('detect：Data URL', () => {
  it('图片 Data URL 给出 MIME、体积、预览块与下载信息', () => {
    const input = 'data:image/png;base64,iVBORw0KGgo='
    const res = expectKind(input, 'dataurl')
    expect(res.fields).toEqual([
      { key: 'mime', value: 'image/png', mono: true },
      { key: 'bytes', value: '8 B', mono: true },
    ])
    expect(res.blocks).toEqual([{ key: 'image', value: input, image: true }])
    expect(res.download).toEqual({ mime: 'image/png', dataUrl: input, sizeBytes: 8 })
    expect(res.copy).toBe(input)
  })

  it('非图片 Data URL 不产生预览块，但仍可下载', () => {
    const res = expectKind('data:application/pdf;base64,JVBERi0xLjQ=', 'dataurl')
    expect(fieldMap(res)).toMatchObject({ mime: 'application/pdf', bytes: '8 B' })
    expect(res.blocks).toEqual([])
    expect(res.download?.mime).toBe('application/pdf')
  })

  it('charset 参数在规范化后会被去掉', () => {
    const res = expectKind('data:text/plain;charset=utf-8;base64,aGVsbG8=', 'dataurl')
    expect(res.copy).toBe('data:text/plain;base64,aGVsbG8=')
    expect(fieldMap(res).mime).toBe('text/plain')
  })

  it('scheme 与 MIME 大小写不敏感，MIME 统一小写', () => {
    const res = expectKind('DATA:IMAGE/PNG;BASE64,iVBORw0KGgo=', 'dataurl')
    expect(fieldMap(res).mime).toBe('image/png')
    expect(res.copy).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('base64 段内的空白被剔除', () => {
    expect(expectKind('data:text/plain;base64,aGVs bG8=', 'dataurl').copy).toBe(
      'data:text/plain;base64,aGVsbG8=',
    )
  })

  it.each([
    'data:text/plain;base64,!!!!',
    'data:text/plain;base64,YQ=',
    'data:image/png,notbase64',
    'data:image/png;base64',
  ])('%s 结构或 base64 段非法，不识别', (input) => {
    expect(detect(input)).toBeNull()
  })

  it('MIME 为空的畸形 Data URL 会被拒绝，但其中的合法 base64 仍会被挖出', () => {
    const res = detect('data:;base64,aGVsbG8=')
    expect(res?.kind).toBe('base64')
    expect(res?.copy).toBe('hello')
  })
})

describe('detect：外壳剥离与成对引号提取', () => {
  it.each([
    ['atob("SGVsbG8gV29ybGQ=")', 6],
    ["btoa('SGVsbG8gV29ybGQ=')", 6],
    ['atob(`SGVsbG8gV29ybGQ=`)', 6],
    ['atob(SGVsbG8gV29ybGQ=)', 5],
    ['ATOB( "SGVsbG8gV29ybGQ=" )', 7],
  ])('%s 剥离函数外壳并精确定位参数', (input, start) => {
    const res = expectKind(input, 'base64')
    expect(res.copy).toBe('Hello World')
    expect(res.sourceMatches?.[0]).toEqual({
      text: 'SGVsbG8gV29ybGQ=',
      startIndex: start,
      endIndex: start + 16,
      active: true,
    })
  })

  it('函数外壳与引号候选会去重，只产生一个匹配项', () => {
    const res = detect('atob("YWFh")')
    expect(res?.items).toHaveLength(1)
    expect(res?.copy).toBe('aaa')
  })

  it.each([
    ['“SGVsbG8gV29ybGQ=”', 'base64'],
    ['‘SGVsbG8gV29ybGQ=’', 'base64'],
    ['`SGVsbG8gV29ybGQ=`', 'base64'],
    ['"SGVsbG8gV29ybGQ="', 'base64'],
    ["'SGVsbG8gV29ybGQ='", 'base64'],
  ])('%s 支持的中文/英文/反引号包裹均能剥离', (input, kind) => {
    const res = expectKind(input, kind)
    expect(res.copy).toBe('Hello World')
    expect(res.sourceMatches?.[0].startIndex).toBe(1)
  })

  it('英文撇号缩写不会被当成成对单引号', () => {
    expect(detect("it's a test")).toBeNull()
    expect(detect("don't parse this")).toBeNull()
  })

  it('中文引号包裹的两个载荷各自成为一项', () => {
    const input = '先说“YWFh”再说“YmJi”'
    const res = detect(input)
    expect(res?.items).toHaveLength(2)
    expect(res?.items?.map((i) => i.copy)).toEqual(['aaa', 'bbb'])
    expect(res?.sourceMatches).toEqual([
      { text: 'YWFh', startIndex: 3, endIndex: 7, active: true },
      { text: 'YmJi', startIndex: 11, endIndex: 15, active: false },
    ])
  })

  it('两个英文双引号载荷会被「整段成对引号」误剥离导致漏识别（现状记录，源码疑点）', () => {
    // 输入首尾都是 "，stripCommonWrappers 先剥掉最外层，得到 YWFh" "YmJi，
    // 该候选又覆盖了两个引号候选，最终解析为空
    expect(detect('"YWFh" "YmJi"')).toBeNull()
  })
})

describe('detect：自由文本中的嵌入式挖掘', () => {
  it('夹在中文之间（无空格）的 Base64 可被挖出', () => {
    const input = '这个密文SGVsbG8gV29ybGQ=发你'
    const res = detect(input)
    expect(res?.kind).toBe('base64')
    expect(res?.copy).toBe('Hello World')
    expect(res?.sourceMatches?.[0]).toEqual({
      text: 'SGVsbG8gV29ybGQ=',
      startIndex: 4,
      endIndex: 20,
      active: true,
    })
  })

  it('空格分隔的 Base64 可被挖出', () => {
    const res = detect('你好 SGVsbG8gV29ybGQ= 好的')
    expect(res?.kind).toBe('base64')
    expect(res?.sourceMatches?.[0]).toEqual({
      text: 'SGVsbG8gV29ybGQ=',
      startIndex: 3,
      endIndex: 19,
      active: true,
    })
  })

  it('句子中的 JWT 被优先按 JWT 解析（kindHint 生效）', () => {
    const token = makeToken({ alg: 'HS256' }, { a: 1 })
    const input = `token: ${token} 已生成`
    const res = detect(input)
    expect(res?.items?.[0].kind).toBe('jwt')
    expect(res?.items?.[0].copy).toBe('{\n  "a": 1\n}')
    const jwtItem = res?.items?.find((i) => i.kind === 'jwt')
    expect(jwtItem?.sourceMatches[0]).toEqual({
      text: token,
      startIndex: 7,
      endIndex: 7 + token.length,
    })
  })

  it('句子中的 JWT 会额外产生一条重叠的伪 URL 项（现状记录，源码疑点）', () => {
    // extractUrls 对整段原文跑裸域名正则，token 的 header.payload 被当成域名，
    // 且去重只针对「带协议 URL」，无法感知已识别的 JWT 区间
    const token = makeToken({ alg: 'HS256' }, { a: 1 })
    const input = `token: ${token} 已生成`
    const res = detect(input)
    const urlItem = res?.items?.find((i) => i.kind === 'url')
    expect(urlItem?.sourceMatch.startIndex).toBe(7)
    expect(urlItem?.sourceMatch.endIndex).toBeLessThan(7 + token.length)
  })

  it('多个 Base64 候选按正文顺序全部保留（含重复内容）', () => {
    const input = '第一个 SGVsbG8gV29ybGQ= 第二个 YWJjZGVmZw== 结束'
    const res = detect(input)
    expect(res?.items).toHaveLength(2)
    expect(res?.items?.map((i) => i.copy)).toEqual(['Hello World', 'abcdefg'])
    expect(res?.items?.every((i) => i.kind === 'base64')).toBe(true)
  })

  it('实体与网址混合时严格按正文出现顺序排列', () => {
    const input = '甲 SGVsbG8gV29ybGQ= 乙 https://a.example.com/1 丙 YWJjZGVmZw== 丁'
    const res = detect(input)
    expect(kindsOf(res)).toEqual(['base64', 'url', 'base64'])
    const starts = (res?.items ?? []).map((i) => i.sourceMatch.startIndex)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(starts[0]).toBe(input.indexOf('SGVsbG8gV29ybGQ='))
    expect(res?.items?.[1].copy).toBe('https://a.example.com/1')
  })

  it('多候选时仅第一项 active，items 内部的区间不带 active 标记', () => {
    const res = detect('第一个 SGVsbG8gV29ybGQ= 第二个 YWJjZGVmZw== 结束')
    expect(res?.sourceMatches?.map((m) => m.active)).toEqual([true, false])
    expect(res?.items?.[0].sourceMatches[0]).not.toHaveProperty('active')
    expect(res?.items?.[1].sourceMatches[0]).not.toHaveProperty('active')
  })

  it('单候选命中时 sourceMatches 带 active: true，同时保留 items', () => {
    const res = detect('“YWFh”')
    expect(res?.sourceMatches).toEqual([{ text: 'YWFh', startIndex: 1, endIndex: 5, active: true }])
    expect(res?.items).toHaveLength(1)
  })
})

describe('detect：误判防护（非支持类型必须返回 null）', () => {
  it.each([
    'Hello World',
    'lorem ipsum dolor sit amet',
    'The quick brown fox jumps over the lazy dog',
    'not a token at all',
    '!!!',
    '...',
  ])('%j 普通英文/标点文本不识别', (input) => {
    expect(detect(input)).toBeNull()
  })

  it.each(['#ff0000', '#fff', 'rgb(255,0,0)', 'rgba(0,0,0,0.5)', 'hsl(0,100%,50%)'])(
    '%s 颜色值不识别（detect 没有 color 类型）',
    (input) => {
      expect(detect(input)).toBeNull()
    },
  )

  it.each(['user@qq.com', 'contact me at user@qq.com', 'mailto:a@b.com'])(
    '%j 邮箱不识别（负向后顾避免把域名当网址）',
    (input) => {
      expect(detect(input)).toBeNull()
    },
  )

  it.each([
    'a=1; b=2; sessionId=abc123',
    'session_id=abc; path=/; HttpOnly',
    'token=abc; Path=/; Secure; SameSite=Lax',
  ])('%j Cookie 串不识别（detect 没有 cookie 类型）', (input) => {
    expect(detect(input)).toBeNull()
  })

  it.each([
    'Debian GNU/Linux 12 (bookworm)',
    '"Debian GNU/Linux 12 (bookworm)"',
    'Ubuntu 22.04',
    'Linux 12',
    'Test 12',
    'Page-12',
    'version 1.2.3',
  ])('%j 版本信息不误判为时间戳', (input) => {
    expect(detect(input)).toBeNull()
  })

  it('纯文本里出现的 xxx.tld 会被当成网址（裸域名提取的副作用，现状记录）', () => {
    expect(expectKind('see file.txt', 'url').copy).toBe('https://file.txt/')
    expect(expectKind('README.md', 'url').copy).toBe('https://readme.md/')
  })
})

describe('detect：输入防护', () => {
  it.each(['', '   ', '\n\t\r', '\u00a0'])('%j 空 / 纯空白输入返回 null', (input) => {
    expect(detect(input)).toBeNull()
  })

  it('长度上限为 50000：恰好 50000 字的合法 JSON 仍可解析', () => {
    const atLimit = `{"a":"${'x'.repeat(50000 - 8)}"}`
    expect(atLimit).toHaveLength(50000)
    expect(expectKind(atLimit, 'json').kind).toBe('json')
  })

  it('超过 50000 字直接返回 null（防止超长日志阻塞主线程）', () => {
    const overLimit = `{"a":"${'x'.repeat(50001 - 8)}"}`
    expect(overLimit).toHaveLength(50001)
    expect(detect(overLimit)).toBeNull()
    expect(detect('a'.repeat(50001))).toBeNull()
  })

  it('恰好 50000 字但不含目标时同样返回 null', () => {
    expect(detect('x'.repeat(50000))).toBeNull()
    expect(detect('q'.repeat(50000))).toBeNull()
  })
})

describe('detect：结果字段的 i18n 标签（中英双语）', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  /** 收集 detect 可能产出的字段 / 内容块 key 对应的 i18n label key（与 DetectResultView 的映射一致） */
  function collectLabelKeys(): string[] {
    const samples = [
      '{"a":1}',
      'YWFh',
      'eyJhIjoxfQ==',
      makeToken({ alg: 'HS256' }, { sub: '123', exp: 4102444800, iat: 1516239022 }),
      '1710000000',
      '550e8400-e29b-41d4-a716-446655440000',
      'deadbeef',
      'iVBORw0KGgo=',
      'data:image/png;base64,iVBORw0KGgo=',
      'data:text/plain;base64,aGVsbG8=',
      'https://example.com/a',
    ]
    const keys = new Set<string>()
    for (const sample of samples) {
      const res = detect(sample)
      if (!res) throw new Error(`样本 ${sample} 未识别，无法收集标签 key`)
      for (const f of res.fields) {
        keys.add(
          f.key.startsWith('claim.')
            ? `tool.jwt.claim.${f.key.slice('claim.'.length)}`
            : `tool.detect.row.${f.key}`,
        )
      }
      for (const b of res.blocks) keys.add(`tool.detect.row.${b.key}`)
    }
    return [...keys]
  }

  it('所有 label key 在 zh / en 语言包中同时存在（防止漏翻译）', () => {
    const keys = collectLabelKeys()
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(i18n.exists(key, { lng: 'zh' }), `zh 缺少 ${key}`).toBe(true)
      expect(i18n.exists(key, { lng: 'en' }), `en 缺少 ${key}`).toBe(true)
    }
  })

  it('切到 en 后所有标签都不含中文', async () => {
    await i18n.changeLanguage('en')
    for (const key of collectLabelKeys()) {
      const label = i18n.t(key)
      expect(label.length, `${key} 英文文案为空`).toBeGreaterThan(0)
      expect(CJK_RE.test(label), `${key} 的英文文案含中文：${label}`).toBe(false)
    }
  })

  it('切到 zh 后标签为中文，或与英文同形的纯技术名（ISO 8601 / MIME）', async () => {
    await i18n.changeLanguage('zh')
    for (const key of collectLabelKeys()) {
      const zhLabel = i18n.t(key)
      const enLabel = i18n.t(key, { lng: 'en' })
      expect(zhLabel.length, `${key} 中文文案为空`).toBeGreaterThan(0)
      expect(
        CJK_RE.test(zhLabel) || zhLabel === enLabel,
        `${key} 的中文文案既无中文也不与英文同形：${zhLabel}`,
      ).toBe(true)
    }
  })
})
