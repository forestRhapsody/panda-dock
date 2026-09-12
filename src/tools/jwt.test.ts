import { describe, expect, it } from 'vitest'

import { decodeJwt, formatDateTime, getClaimLabel, SAMPLE_JWT } from './jwt'

/** 用给定的 header / payload 拼一个三段式 token（签名段内容不参与解码，固定占位） */
function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeToken(header: unknown, payload: unknown, signature = 'sig'): string {
  return `${b64url(header)}.${b64url(payload)}.${signature}`
}

describe('decodeJwt', () => {
  it('解码标准三段式 token', () => {
    const token = makeToken({ alg: 'HS256', typ: 'JWT' }, { sub: '1234567890', name: 'John' })
    const res = decodeJwt(token)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.alg).toBe('HS256')
    expect(JSON.parse(res.data.headerText)).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(JSON.parse(res.data.payloadText)).toEqual({ sub: '1234567890', name: 'John' })
    expect(res.data.signatureB64).toBe('sig')
  })

  it('自动清洗 Bearer 前缀（大小写不敏感、允许多个空格）', () => {
    const token = makeToken({ alg: 'none' }, { a: 1 })
    expect(decodeJwt(`Bearer ${token}`).ok).toBe(true)
    expect(decodeJwt(`bearer   ${token}`).ok).toBe(true)
    expect(decodeJwt(`  ${token}  `).ok).toBe(true)
  })

  it('段数不为 3 / 存在空段 / 段内非法字符时返回错误而非抛错', () => {
    expect(decodeJwt('a.b').ok).toBe(false)
    expect(decodeJwt('a..c').ok).toBe(false)
    expect(decodeJwt('a$b.c.d').ok).toBe(false)
    expect(decodeJwt('').ok).toBe(false)
  })

  it('payload 不是合法 JSON 时返回错误而非抛错', () => {
    const header = b64url({ alg: 'HS256' })
    const payload = btoa('not-json').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeJwt(`${header}.${payload}.sig`).ok).toBe(false)
  })

  it('标准声明按当地日历转换并给出语义标签', () => {
    const exp = 4102444800 // 2100-01-01T00:00:00Z
    const token = makeToken({ alg: 'HS256' }, { iss: 'issuer', exp, iat: 1516239022 })
    const res = decodeJwt(token)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.claims.map((c) => c.key)).toEqual(['iss', 'exp', 'iat'])
    const expRow = res.data.claims.find((c) => c.key === 'exp')
    expect(expRow?.display).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(expRow?.hint?.expired).toBe(false)
    expect(res.data.claims.find((c) => c.key === 'iss')?.display).toBe('issuer')
  })

  it('exp 早于当前时间时 hint.expired 为 true', () => {
    const res = decodeJwt(makeToken({ alg: 'HS256' }, { exp: 1000000000 }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.claims.find((c) => c.key === 'exp')?.hint?.expired).toBe(true)
  })

  it('exp 以毫秒给定时自动折算为秒（展示结果一致）', () => {
    const secs = 4102444800
    const fromSecs = decodeJwt(makeToken({ alg: 'HS256' }, { exp: secs }))
    const fromMs = decodeJwt(makeToken({ alg: 'HS256' }, { exp: secs * 1000 }))
    expect(fromSecs.ok && fromMs.ok).toBe(true)
    if (!fromSecs.ok || !fromMs.ok) return
    expect(fromMs.data.claims.find((c) => c.key === 'exp')?.display).toBe(
      fromSecs.data.claims.find((c) => c.key === 'exp')?.display,
    )
  })

  it('非标准声明与非标量值不进入 claims', () => {
    const res = decodeJwt(makeToken({ alg: 'HS256' }, { sub: { nested: 1 }, custom: 'x' }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.claims).toEqual([])
  })

  it('缺少 alg 时回退为未知算法文案，而非空串', () => {
    const res = decodeJwt(makeToken({ typ: 'JWT' }, { a: 1 }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.alg.length).toBeGreaterThan(0)
  })

  it('可解码内置示例 token', () => {
    const res = decodeJwt(SAMPLE_JWT)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.alg).toBe('HS256')
    expect(res.data.signatureB64).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
  })
})

describe('formatDateTime / getClaimLabel', () => {
  it('统一格式化为 YYYY-MM-DD HH:mm:ss', () => {
    expect(formatDateTime(0)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(formatDateTime(4102444800)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('标准声明返回本地化标签（不是裸 key）', () => {
    const label = getClaimLabel('exp')
    expect(label.length).toBeGreaterThan(0)
    expect(label).not.toBe('exp')
  })
})
