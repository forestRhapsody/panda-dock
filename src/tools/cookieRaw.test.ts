import { afterAll, describe, expect, it } from 'vitest'

import i18n from '@/i18n'

import { parseRawCookie, serializeCookieToRaw } from './cookieRaw'

describe('parseRawCookie', () => {
  it('解析分号拼接的多项键值串', () => {
    const res = parseRawCookie('a=1; b=2; c=3')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.cookies.map((c) => c.name)).toEqual(['a', 'b', 'c'])
    expect(res.cookies.map((c) => c.value)).toEqual(['1', '2', '3'])
    expect(res.cookies.every((c) => c.path === '/' && c.secure === false)).toBe(true)
  })

  it('解析完整 Set-Cookie 行（含前缀与全部属性）', () => {
    const res = parseRawCookie(
      'Set-Cookie: token=abc; Domain=example.com; Path=/api; HttpOnly; Secure; SameSite=None',
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.cookies).toHaveLength(1)
    expect(res.cookies[0]).toMatchObject({
      name: 'token',
      value: 'abc',
      domain: 'example.com',
      path: '/api',
      httpOnly: true,
      secure: true,
      sameSite: 'no_restriction',
    })
  })

  it('SameSite=None 时自动置 secure', () => {
    const res = parseRawCookie('t=1; SameSite=None')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.cookies[0]).toMatchObject({ sameSite: 'no_restriction', secure: true })
  })

  it('Expires 解析为秒级时间戳', () => {
    const res = parseRawCookie('t=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.cookies[0].expirationDate).toBe(Date.UTC(2031, 0, 1) / 1000)
  })

  it('Max-Age 换算为相对当前时间的过期时间', () => {
    const before = Math.floor(Date.now() / 1000)
    const res = parseRawCookie('t=1; Max-Age=3600')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const exp = res.cookies[0].expirationDate ?? 0
    expect(exp).toBeGreaterThanOrEqual(before + 3599)
    expect(exp).toBeLessThanOrEqual(before + 3601)
  })

  it('解析 JSON 单对象与 JSON 数组（兼容 Name / key 别名）', () => {
    const one = parseRawCookie('{"name":"x","value":"1","httpOnly":true}')
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(one.cookies[0]).toMatchObject({ name: 'x', value: '1', httpOnly: true })

    const many = parseRawCookie('[{"key":"a","Value":"1"},{"Name":"b","value":"2"}]')
    expect(many.ok).toBe(true)
    if (!many.ok) return
    expect(many.cookies.map((c) => c.name)).toEqual(['a', 'b'])
  })

  it('默认 domain / path 会回填到未显式声明的条目', () => {
    const res = parseRawCookie('a=1; b=2', 'example.com', '/app')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.cookies.every((c) => c.domain === 'example.com' && c.path === '/app')).toBe(true)
  })

  it('空输入 / 无键值对 / 非法 JSON 给出错误而非抛错', () => {
    expect(parseRawCookie('').ok).toBe(false)
    expect(parseRawCookie('   ').ok).toBe(false)
    expect(parseRawCookie('这不是 cookie').ok).toBe(false)
    expect(parseRawCookie('{bad json').ok).toBe(false)
    expect(parseRawCookie('[1, 2]').ok).toBe(false)
  })
})

describe('serializeCookieToRaw', () => {
  it('Set-Cookie 形式包含全部属性，且 SameSite=None 附带 Secure', () => {
    const raw = serializeCookieToRaw({
      name: 'token',
      value: 'abc',
      domain: 'example.com',
      path: '/api',
      httpOnly: true,
      sameSite: 'no_restriction',
    })
    expect(raw).toBe('token=abc; Domain=example.com; Path=/api; SameSite=None; Secure; HttpOnly')
  })

  it('header 形式只输出 name=value', () => {
    expect(serializeCookieToRaw({ name: 'a', value: '1' }, 'header')).toBe('a=1')
  })

  it('json 形式输出格式化 JSON', () => {
    const raw = serializeCookieToRaw({ name: 'a', value: '1' }, 'json')
    expect(JSON.parse(raw)).toEqual({ name: 'a', value: '1' })
  })

  it('键值全空时输出空串', () => {
    expect(serializeCookieToRaw({ name: '', value: '' })).toBe('')
  })

  it('与 parseRawCookie 往返后关键字段不丢失', () => {
    const raw = serializeCookieToRaw({
      name: 'sid',
      value: 'v=1',
      domain: 'example.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    })
    const back = parseRawCookie(raw)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.cookies[0]).toMatchObject({
      name: 'sid',
      value: 'v=1',
      domain: 'example.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    })
  })
})

/** T127：Raw 解析的错误文案必须随界面语言切换（历史上是硬编码中文，英文界面会显示中文） */
describe('parseRawCookie 错误文案本地化', () => {
  const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/
  const badInputs = ['', '   ', '这不是 cookie', '{bad json', '[1, 2]', '[]', '[{"value":"1"}]']

  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('英文界面下不出现中文，且不是裸 key', async () => {
    await i18n.changeLanguage('en')
    for (const input of badInputs) {
      const res = parseRawCookie(input)
      expect(res.ok, `${JSON.stringify(input)} 应解析失败`).toBe(false)
      if (res.ok) continue
      expect(res.error.length, `${JSON.stringify(input)} 文案为空`).toBeGreaterThan(0)
      expect(CJK.test(res.error), `${JSON.stringify(input)} 的英文文案含中文：${res.error}`).toBe(
        false,
      )
      expect(res.error.startsWith('tool.'), `${JSON.stringify(input)} 未翻译：${res.error}`).toBe(
        false,
      )
    }
  })

  it('错误文案按输入类型区分（不是同一个兜底串）', async () => {
    await i18n.changeLanguage('en')
    const texts = new Set<string>()
    for (const input of badInputs) {
      const res = parseRawCookie(input)
      if (!res.ok) texts.add(res.error)
    }
    expect(texts.size).toBeGreaterThanOrEqual(4)
  })

  it('中文界面下给出中文文案', async () => {
    await i18n.changeLanguage('zh')
    for (const input of badInputs) {
      const res = parseRawCookie(input)
      if (!res.ok) expect(CJK.test(res.error), `${input} 中文文案异常：${res.error}`).toBe(true)
    }
  })
})
