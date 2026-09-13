import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import {
  base64UrlToBytes,
  decodeJwt,
  formatDateTime,
  getClaimLabel,
  SAMPLE_JWT,
  SAMPLE_SECRET,
  verifyJwtSignature,
} from './jwt'

/** 中日韩字符与全角标点：用来断言「英文界面下不出现中文」 */
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

/** 用给定的 header / payload 拼一个三段式 token（签名段内容不参与解码，固定占位） */
function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 按 UTF-8 编码为 base64url：覆盖 btoa 无法处理非 Latin1 字符（中文 / ÿ）的场景 */
function b64urlText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeToken(header: unknown, payload: unknown, signature = 'sig'): string {
  return `${b64url(header)}.${b64url(payload)}.${signature}`
}

/** 取某个标准声明的行；解码失败直接抛错，避免测试里到处写 ok 收窄 */
function claimOf(payload: unknown, key: string) {
  const res = decodeJwt(makeToken({ alg: 'HS256' }, payload))
  if (!res.ok) throw new Error(`解码失败：${res.error}`)
  return res.data.claims.find((c) => c.key === key)
}

describe('decodeJwt 基础解码', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('解码标准三段式 token，header / payload 以格式化 JSON 文本给出', () => {
    const res = decodeJwt(
      makeToken({ alg: 'HS256', typ: 'JWT' }, { sub: '1234567890', name: 'John' }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.alg).toBe('HS256')
    expect(res.data.headerText).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}')
    expect(JSON.parse(res.data.payloadText)).toEqual({ sub: '1234567890', name: 'John' })
    expect(res.data.signatureB64).toBe('sig')
  })

  it('自动清洗 Bearer 前缀（大小写不敏感、允许多个空白与换行）', () => {
    const token = makeToken({ alg: 'none' }, { a: 1 })
    expect(decodeJwt(`Bearer ${token}`).ok).toBe(true)
    expect(decodeJwt(`bearer   ${token}`).ok).toBe(true)
    expect(decodeJwt(`BeArEr\n${token}`).ok).toBe(true)
    expect(decodeJwt(`  ${token}  `).ok).toBe(true)
  })

  it('URL-safe base64 的 - / _ 段能正确还原（含非 Latin1 字符）', () => {
    const header = b64urlText('{"alg":"HS256"}')
    const dashPayload = b64urlText('{"a":"??>"}')
    const underscorePayload = b64urlText('{"a":"ÿÿÿ"}')
    // 这两段分别命中 base64 的 + 与 /，因此 URL-safe 化后必带 - 与 _
    expect(dashPayload).toContain('-')
    expect(underscorePayload).toContain('_')

    const r1 = decodeJwt(`${header}.${dashPayload}.sig`)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(JSON.parse(r1.data.payloadText)).toEqual({ a: '??>' })

    const r2 = decodeJwt(`${header}.${underscorePayload}.sig`)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(JSON.parse(r2.data.payloadText)).toEqual({ a: 'ÿÿÿ' })
  })

  it('payload 为 UTF-8 中文时按 UTF-8 解码而非 Latin1 乱码', () => {
    const token = `${b64urlText('{"alg":"HS256"}')}.${b64urlText(JSON.stringify({ name: '张三' }))}.sig`
    const res = decodeJwt(token)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(JSON.parse(res.data.payloadText)).toEqual({ name: '张三' })
  })

  it('签名段不做 Base64URL 字符校验，原样透传（仅展示用）', () => {
    const res = decodeJwt(makeToken({ alg: 'HS256' }, { a: 1 }, 'sig+/=!~'))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.signatureB64).toBe('sig+/=!~')
  })

  it('可解码内置示例 token', () => {
    const res = decodeJwt(SAMPLE_JWT)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.alg).toBe('HS256')
    expect(res.data.signatureB64).toBe('NjH-41io2kQLrj4eb6E3lNMBGKD0qc_T5QyRs0BTxDs')
    expect(res.data.claims.map((c) => c.key)).toEqual(['sub', 'exp', 'iat'])
  })

  it('超长输入不抛异常，只返回解码失败', () => {
    const huge = `${'a'.repeat(100000)}.b.c`
    expect(() => decodeJwt(huge)).not.toThrow()
    expect(decodeJwt(huge).ok).toBe(false)
  })
})

describe('decodeJwt 错误与降级分支', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('段数不为 3 时报错并带上实际段数', () => {
    const cases: [string, number][] = [
      ['a.b', 2],
      ['a.b.c.d', 4],
      ['', 1],
      ['a', 1],
      ['Bearer', 1],
      ['Bearer   ', 1],
    ]
    for (const [input, count] of cases) {
      const res = decodeJwt(input)
      expect(res.ok, input).toBe(false)
      if (res.ok) continue
      expect(res.error, input).toContain(String(count))
      expect(CJK.test(res.error), input).toBe(true)
    }
  })

  it('存在空段时报空段错误（header / payload / signature 都不能为空）', () => {
    for (const input of ['a.b.', '.b.c', 'a..c', '..']) {
      const res = decodeJwt(input)
      expect(res.ok, input).toBe(false)
      if (!res.ok) expect(res.error, input).toContain('空白')
    }
  })

  it('header / payload 含非 Base64URL 字符时报非法字符错误', () => {
    for (const input of [
      'a$b.c.d',
      'a.b$.c',
      'a b.c.d',
      'a. b.c',
      '中.b.c',
      'a+b.c.d',
      'a/b.c.d',
    ]) {
      const res = decodeJwt(input)
      expect(res.ok, input).toBe(false)
      if (!res.ok) expect(res.error, input).toContain('非法字符')
    }
  })

  it('带 = padding 的标准 base64 段被拒绝（JWT 要求无 padding 的 base64url）', () => {
    const padded = btoa(JSON.stringify({ a: 1 })) // eyJhIjoxfQ==
    expect(padded).toContain('=')
    const res = decodeJwt(`${b64url({ alg: 'HS256' })}.${padded}.sig`)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('非法字符')
  })

  it('字符集合法但 base64 无法解码时返回错误而非抛异常', () => {
    // 单字符段补 padding 后是非法 base64（如 a===），atob 会抛错，需被外层兜住
    const res = decodeJwt('a.b.c')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(typeof res.error).toBe('string')
      expect(res.error.length).toBeGreaterThan(0)
    }
  })

  it('header 不是合法 JSON 时错误信息指明 Header', () => {
    const res = decodeJwt(`${b64urlText('not-json')}.${b64url({ a: 1 })}.sig`)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('Header')
      expect(res.error).toContain('不是合法 JSON')
    }
  })

  it('payload 不是合法 JSON 时错误信息指明 Payload', () => {
    const res = decodeJwt(`${b64url({ alg: 'HS256' })}.${b64urlText('not-json')}.sig`)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('Payload')
      expect(res.error).toContain('不是合法 JSON')
    }
  })

  it('header / payload 是合法 JSON 但非对象时仍可解码，claims 为空', () => {
    for (const payload of ['123', 'null', '[1,2]', '"hi"', 'true']) {
      const res = decodeJwt(`${b64url({ alg: 'none' })}.${b64urlText(payload)}.sig`)
      expect(res.ok, payload).toBe(true)
      if (res.ok) expect(res.data.claims, payload).toEqual([])
    }
  })

  it('header 缺少 / 非法 alg 时回退为本地化的未知算法', () => {
    const headers: unknown[] = [
      { typ: 'JWT' },
      { alg: 123 },
      { alg: '' },
      { alg: null },
      'not-object',
      42,
    ]
    for (const header of headers) {
      const res = decodeJwt(makeToken(header, { a: 1 }))
      expect(res.ok, JSON.stringify(header)).toBe(true)
      if (res.ok) expect(res.data.alg, JSON.stringify(header)).toBe('未知')
    }
  })

  it('HS / RS / none 等算法原样返回，未注册算法也不改写', () => {
    for (const alg of ['HS256', 'RS256', 'ES512', 'none', 'custom-alg']) {
      const res = decodeJwt(makeToken({ alg }, { a: 1 }))
      expect(res.ok, alg).toBe(true)
      if (res.ok) expect(res.data.alg, alg).toBe(alg)
    }
  })
})

describe('decodeJwt 标准声明 claims', () => {
  const NOW_MS = 1_700_000_000_000 // 2023-11-14T22:13:20Z
  const NOW_SEC = NOW_MS / 1000

  beforeEach(async () => {
    await i18n.changeLanguage('zh')
    vi.useFakeTimers({ now: NOW_MS })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('按固定顺序输出白名单声明，未注册的 key 被忽略', () => {
    const res = decodeJwt(
      makeToken(
        { alg: 'HS256' },
        {
          jti: 'id',
          iat: NOW_SEC - 10,
          exp: NOW_SEC + 100,
          aud: 'audience',
          sub: 'subject',
          iss: 'issuer',
          nbf: NOW_SEC - 100,
          name: 'John',
        },
      ),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.claims.map((c) => c.key)).toEqual([
      'iss',
      'sub',
      'aud',
      'exp',
      'nbf',
      'iat',
      'jti',
    ])
    expect(res.data.claims.every((c) => c.label.length > 0)).toBe(true)
    expect(res.data.claims.find((c) => c.key === 'sub')?.display).toBe('subject')
  })

  it('null / 对象 / 数组值不进入 claims，布尔值按字符串展示', () => {
    const res = decodeJwt(
      makeToken({ alg: 'HS256' }, { sub: null, iss: true, aud: { a: 1 }, jti: ['x'] }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.claims.map((c) => [c.key, c.display])).toEqual([['iss', 'true']])
    expect(res.data.claims[0].hint).toBeUndefined()
  })

  it('日期类声明的非数字值只原样展示，不折算为时间也不给提示', () => {
    const res = decodeJwt(makeToken({ alg: 'HS256' }, { exp: '1800000000', nbf: true, iat: 'x' }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.claims.map((c) => [c.key, c.display])).toEqual([
      ['exp', '1800000000'],
      ['nbf', 'true'],
      ['iat', 'x'],
    ])
    expect(res.data.claims.every((c) => c.hint === undefined)).toBe(true)
  })

  it('exp 毫秒值（> 1e11）自动折算为秒再展示', () => {
    const ms = 18016239022000
    const res = decodeJwt(makeToken({ alg: 'HS256' }, { exp: ms }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const display = res.data.claims.find((c) => c.key === 'exp')?.display
    expect(display).toBe(formatDateTime(Math.floor(ms / 1000)))
    expect(display).not.toBe(formatDateTime(ms))
  })

  it('1e11 是秒 / 毫秒判定的边界（等于按秒，超过才按毫秒）', () => {
    const atBoundary = claimOf({ exp: 1e11 }, 'exp')
    expect(atBoundary?.display).toBe(formatDateTime(1e11))

    const above = claimOf({ exp: 1e11 + 1000 }, 'exp')
    expect(above?.display).toBe(formatDateTime(Math.floor((1e11 + 1000) / 1000)))
    expect(above?.display).not.toBe(atBoundary?.display)
  })

  it('exp 已过期：刚好到期算过期，满一天给「N 天前」否则只给「已过期」', () => {
    const exactly = claimOf({ exp: NOW_SEC }, 'exp')
    expect(exactly?.hint?.expired).toBe(true)
    expect(exactly?.hint?.text).toContain('已过期')

    const secondsAgo = claimOf({ exp: NOW_SEC - 10 }, 'exp')
    expect(secondsAgo?.hint?.expired).toBe(true)
    expect(secondsAgo?.hint?.text).toBe('已过期')

    const daysAgo = claimOf({ exp: NOW_SEC - 5 * 86400 - 10 }, 'exp')
    expect(daysAgo?.hint?.expired).toBe(true)
    expect(daysAgo?.hint?.text).toContain('5')
    expect(daysAgo?.hint?.text).toContain('天前')
  })

  it('exp 未过期：按剩余量级给天 / 小时 / 分钟提示，不足 1 分钟至少显示 1 分钟', () => {
    const days = claimOf({ exp: NOW_SEC + 10 * 86400 + 5 }, 'exp')
    expect(days?.hint?.expired).toBe(false)
    expect(days?.hint?.text).toContain('10')
    expect(days?.hint?.text).toContain('剩余')

    const hours = claimOf({ exp: NOW_SEC + 5 * 3600 + 30 }, 'exp')
    expect(hours?.hint?.text).toContain('5')
    expect(hours?.hint?.text).toContain('小时')

    const mins = claimOf({ exp: NOW_SEC + 120 }, 'exp')
    expect(mins?.hint?.text).toContain('2')
    expect(mins?.hint?.text).toContain('分钟')

    const clamp = claimOf({ exp: NOW_SEC + 30 }, 'exp')
    expect(clamp?.hint?.text).toContain('1')
    expect(clamp?.hint?.expired).toBe(false)
  })

  it('nbf 未到生效时间给「N 天后 / 小时后 / 分钟后生效」，已生效不给提示', () => {
    const days = claimOf({ nbf: NOW_SEC + 2 * 86400 + 10 }, 'nbf')
    expect(days?.hint?.text).toContain('2')
    expect(days?.hint?.text).toContain('生效')

    const hours = claimOf({ nbf: NOW_SEC + 3 * 3600 + 5 }, 'nbf')
    expect(hours?.hint?.text).toContain('3')

    const mins = claimOf({ nbf: NOW_SEC + 90 }, 'nbf')
    expect(mins?.hint?.text).toContain('1')
    expect(mins?.hint?.text).toContain('分钟')

    const clamp = claimOf({ nbf: NOW_SEC + 20 }, 'nbf')
    expect(clamp?.hint?.text).toContain('1')

    expect(claimOf({ nbf: NOW_SEC - 10 }, 'nbf')?.hint).toBeUndefined()
    expect(claimOf({ nbf: NOW_SEC }, 'nbf')?.hint).toBeUndefined()
  })

  it('iat 给「N 天 / 小时 / 分钟前签发」，刚签发与未来时间都给「刚刚签发」', () => {
    const days = claimOf({ iat: NOW_SEC - 3 * 86400 - 10 }, 'iat')
    expect(days?.hint?.text).toContain('3')
    expect(days?.hint?.text).toContain('签发')

    const hours = claimOf({ iat: NOW_SEC - 2 * 3600 - 5 }, 'iat')
    expect(hours?.hint?.text).toContain('2')
    expect(hours?.hint?.text).toContain('小时')

    const mins = claimOf({ iat: NOW_SEC - 5 * 60 }, 'iat')
    expect(mins?.hint?.text).toContain('5')
    expect(mins?.hint?.text).toContain('分钟')

    expect(claimOf({ iat: NOW_SEC - 30 }, 'iat')?.hint?.text).toContain('刚刚')
    expect(claimOf({ iat: NOW_SEC + 9999 }, 'iat')?.hint?.text).toContain('刚刚')
  })

  it('日期声明的 display 与 formatDateTime 一致（本地日历文本）', () => {
    const exp = NOW_SEC + 86400
    const res = decodeJwt(makeToken({ alg: 'HS256' }, { exp }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.claims.find((c) => c.key === 'exp')?.display).toBe(formatDateTime(exp))
  })
})

describe('formatDateTime', () => {
  it('按本地日历格式化为 YYYY-MM-DD HH:mm:ss 并补零', () => {
    expect(formatDateTime(new Date(2025, 0, 2, 3, 4, 5).getTime() / 1000)).toBe(
      '2025-01-02 03:04:05',
    )
    expect(formatDateTime(new Date(2025, 10, 9, 8, 7, 6).getTime() / 1000)).toBe(
      '2025-11-09 08:07:06',
    )
  })

  it('epoch / 负秒 / 亚秒：回读本地时间与原始毫秒一致（亚秒被截断）', () => {
    // 用本地解析回读，避免断言依赖运行环境时区
    const roundTrip = (secs: number) => Date.parse(formatDateTime(secs).replace(' ', 'T'))
    expect(roundTrip(0)).toBe(0)
    expect(roundTrip(-1)).toBe(-1000)
    expect(roundTrip(1780000000)).toBe(1780000000000)
    expect(roundTrip(0.5)).toBe(0)
  })

  it('非法 / 超出 Date 范围的秒数退化为原始数字字符串，而不是抛异常', () => {
    expect(formatDateTime(NaN)).toBe('NaN')
    expect(formatDateTime(Infinity)).toBe('Infinity')
    expect(formatDateTime(-Infinity)).toBe('-Infinity')
    expect(formatDateTime(1e15)).toBe('1000000000000000')
  })

  it('Date 上限（±8.64e15 ms）仍能格式化出扩展年份', () => {
    expect(formatDateTime(8640000000000)).toMatch(/^275760-/)
  })
})

describe('getClaimLabel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('标准声明返回本地化标签而非裸 key（带 key 后缀便于识别）', () => {
    for (const key of ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti']) {
      const label = getClaimLabel(key)
      expect(label.length, key).toBeGreaterThan(0)
      expect(label, key).not.toBe(key)
      expect(label, key).toContain(`(${key})`)
      expect(CJK.test(label), key).toBe(true)
    }
  })

  it('未注册的 key 回退为 key 本身', () => {
    expect(getClaimLabel('custom')).toBe('custom')
    expect(getClaimLabel('name')).toBe('name')
  })
})

describe('jwt 文案 i18n（中英双语）', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('英文界面下错误 / 算法 / 声明 / 提示文案均不含中文', async () => {
    await i18n.changeLanguage('en')

    const alg = decodeJwt(makeToken({ typ: 'JWT' }, { a: 1 }))
    expect(alg.ok).toBe(true)
    if (alg.ok) {
      expect(alg.data.alg).toBe('Unknown')
      expect(CJK.test(alg.data.alg)).toBe(false)
    }

    const err = decodeJwt('a.b')
    expect(err.ok).toBe(false)
    if (!err.ok) {
      expect(CJK.test(err.error)).toBe(false)
      expect(err.error).toContain('2')
    }

    expect(CJK.test(getClaimLabel('exp'))).toBe(false)

    // 示例 token 的 exp 在 2540 年（未过期）、iat 在 2018 年，两条提示都会被渲染
    const sample = decodeJwt(SAMPLE_JWT)
    expect(sample.ok).toBe(true)
    if (sample.ok) {
      const hints = sample.data.claims.map((c) => c.hint?.text ?? '')
      expect(hints).toHaveLength(3)
      for (const text of hints) expect(CJK.test(text), text).toBe(false)
    }
  })

  it('中文界面下同一批文案均为中文', async () => {
    await i18n.changeLanguage('zh')

    const alg = decodeJwt(makeToken({ typ: 'JWT' }, { a: 1 }))
    expect(alg.ok).toBe(true)
    if (alg.ok) expect(alg.data.alg).toBe('未知')

    const err = decodeJwt('a.b')
    expect(err.ok).toBe(false)
    if (!err.ok) expect(CJK.test(err.error)).toBe(true)

    expect(CJK.test(getClaimLabel('exp'))).toBe(true)

    const sample = decodeJwt(SAMPLE_JWT)
    expect(sample.ok).toBe(true)
    if (sample.ok) {
      // 只有日期类声明（exp / iat）带 hint，sub 没有
      const hints = sample.data.claims.filter((row) => row.hint)
      expect(hints).toHaveLength(2)
      for (const row of hints) expect(CJK.test(row.hint?.text ?? ''), row.key).toBe(true)
    }
  })
})

describe('verifyJwtSignature HMAC 签名验证', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('使用正确 secret 验证内置 SAMPLE_JWT 返回 valid', async () => {
    const res = await verifyJwtSignature(SAMPLE_JWT, SAMPLE_SECRET)
    expect(res.status).toBe('valid')
    expect(res.message).toBe('签名验证通过')
  })

  it('使用错误 secret 验证 SAMPLE_JWT 返回 invalid', async () => {
    const res = await verifyJwtSignature(SAMPLE_JWT, 'wrong-secret')
    expect(res.status).toBe('invalid')
    expect(res.message).toBe('签名验证失败（Secret 不匹配）')
  })

  it('支持 HS384 签名验证', async () => {
    const token =
      'eyJhbGciOiJIUzM4NCIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJpYXQiOjE1MTYyMzkwMjJ9.G8qb5luyb4lsDsPbJZOMrhfEobhasc0f1V48yYv_3aL0peU7YzyDqhZpHwB4EqpC'
    const validRes = await verifyJwtSignature(token, 'secret-384')
    expect(validRes.status).toBe('valid')
    expect(validRes.message).toBe('签名验证通过')

    const invalidRes = await verifyJwtSignature(token, 'wrong-384')
    expect(invalidRes.status).toBe('invalid')
  })

  it('支持 HS512 签名验证', async () => {
    const token =
      'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJpYXQiOjE1MTYyMzkwMjJ9.AnltT5nduOTxHJh5qh4nclJ3GiExGRlIREBW__JZ8ug6zoKIqLYYhItF166Bh9YSzb2R6pTFzHSQ8XeZf1jlvQ'
    const validRes = await verifyJwtSignature(token, 'secret-512')
    expect(validRes.status).toBe('valid')
    expect(validRes.message).toBe('签名验证通过')

    const invalidRes = await verifyJwtSignature(token, 'wrong-512')
    expect(invalidRes.status).toBe('invalid')
  })

  it('非 HMAC 算法（如 RS256、none）返回 unsupported', async () => {
    const rsToken = makeToken({ alg: 'RS256' }, { sub: '123' }, 'sig')
    const rsRes = await verifyJwtSignature(rsToken, 'secret')
    expect(rsRes.status).toBe('unsupported')
    expect(rsRes.message).toContain('RS256')

    const noneToken = makeToken({ alg: 'none' }, { sub: '123' }, 'sig')
    const noneRes = await verifyJwtSignature(noneToken, 'secret')
    expect(noneRes.status).toBe('unsupported')
    expect(noneRes.message).toContain('none')
  })

  it('畸形 token 或空段返回 invalid 错误提示', async () => {
    const badSegments = await verifyJwtSignature('a.b', 'sec')
    expect(badSegments.status).toBe('invalid')
    expect(badSegments.message).toBe('Token 格式无效')

    const emptySeg = await verifyJwtSignature('a..c', 'sec')
    expect(emptySeg.status).toBe('invalid')

    const badHeader = await verifyJwtSignature('!!!.b.c', 'sec')
    expect(badHeader.status).toBe('invalid')
  })

  it('英文环境下提示文案为英文', async () => {
    await i18n.changeLanguage('en')
    const valid = await verifyJwtSignature(SAMPLE_JWT, SAMPLE_SECRET)
    expect(valid.status).toBe('valid')
    expect(valid.message).toBe('Signature verified')
    expect(CJK.test(valid.message)).toBe(false)

    const invalid = await verifyJwtSignature(SAMPLE_JWT, 'wrong')
    expect(invalid.status).toBe('invalid')
    expect(invalid.message).toBe('Invalid signature (secret mismatch)')
    expect(CJK.test(invalid.message)).toBe(false)
  })

  it('base64UrlToBytes 正常解析且补齐 padding', () => {
    const bytes = base64UrlToBytes('YQ') // 'a'
    expect(bytes).toEqual(new Uint8Array([97]))
  })
})
