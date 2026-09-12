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

  it('引号内的分号不当作分隔符：RFC 6265 的 quoted-string 值不被截断', () => {
    const res = parseRawCookie('note="a;b"; theme=dark')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.cookies.map((c) => c.name)).toEqual(['note', 'theme'])
    // 引号按原样保留在值里：Raw 模式要能原样往返
    expect(res.cookies[0].value).toBe('"a;b"')
    expect(res.cookies[1].value).toBe('dark')
  })

  it('带引号值的完整 Set-Cookie 行：属性照常解析，值不被截断', () => {
    const res = parseRawCookie('Set-Cookie: note="a;b"; Domain=example.com; Path=/; HttpOnly')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.cookies).toHaveLength(1)
    expect(res.cookies[0]).toMatchObject({
      name: 'note',
      value: '"a;b"',
      domain: 'example.com',
      path: '/',
      httpOnly: true,
    })
  })

  it('引号值可以原样往返：序列化后再解析得到同一个值', () => {
    const raw = serializeCookieToRaw({ name: 'note', value: '"a;b"' })
    expect(raw).toBe('note="a;b"')
    const back = parseRawCookie(raw)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.cookies[0].value).toBe('"a;b"')
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

/** 解析成功时直接取 cookies，避免每个用例都写一遍类型收窄 */
function cookiesOf(raw: string, domain?: string, path?: string) {
  const res = parseRawCookie(raw, domain, path)
  if (!res.ok) throw new Error(`期望解析成功，实际失败：${res.error}`)
  return res.cookies
}

/** 解析失败时直接取 error，成功即让用例失败 */
function errorOf(raw: string): string {
  const res = parseRawCookie(raw)
  if (res.ok) throw new Error(`期望解析失败，实际解析出 ${res.cookies.length} 条 Cookie`)
  return res.error
}

describe('serializeCookieToRaw：属性组合与格式边界', () => {
  it('Expires 用 UTC 字符串；非法值（NaN）不输出', () => {
    const exp = Date.UTC(2031, 5, 15, 12, 30, 45) / 1000
    expect(serializeCookieToRaw({ name: 't', value: '1', expirationDate: exp })).toBe(
      `t=1; Expires=${new Date(exp * 1000).toUTCString()}`,
    )
    // 非法时间戳仍不产出 Expires（保留原有护栏）
    expect(serializeCookieToRaw({ name: 't', value: '1', expirationDate: Number.NaN })).toBe('t=1')
  })

  it('expirationDate: 0（1970-01-01）是合法时间戳，照常输出 1970 的 Expires', () => {
    // 旧代码用 `if (cookie.expirationDate)` 的真值判断，会把 0 静默省略成会话 Cookie
    expect(serializeCookieToRaw({ name: 't', value: '1', expirationDate: 0 })).toBe(
      't=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    )
  })

  it('SameSite 三档首字母大写，unspecified 不输出', () => {
    expect(serializeCookieToRaw({ name: 't', value: '1', sameSite: 'lax' })).toBe(
      't=1; SameSite=Lax',
    )
    expect(serializeCookieToRaw({ name: 't', value: '1', sameSite: 'strict' })).toBe(
      't=1; SameSite=Strict',
    )
    expect(serializeCookieToRaw({ name: 't', value: '1', sameSite: 'unspecified' })).toBe('t=1')
  })

  it('SameSite=None 自动补 Secure，且 secure=true 时不会重复输出', () => {
    const raw = 't=1; SameSite=None; Secure'
    expect(serializeCookieToRaw({ name: 't', value: '1', sameSite: 'no_restriction' })).toBe(raw)
    const both = serializeCookieToRaw({
      name: 't',
      value: '1',
      sameSite: 'no_restriction',
      secure: true,
    })
    expect(both).toBe(raw)
    expect(both.split('Secure')).toHaveLength(2)
  })

  it('全 false / 空字符串的属性不输出（不产生 "Domain=" 这类空声明）', () => {
    expect(
      serializeCookieToRaw({
        name: 't',
        value: '1',
        domain: '',
        path: '',
        secure: false,
        httpOnly: false,
      }),
    ).toBe('t=1')
    expect(serializeCookieToRaw({ name: 't', value: '1', httpOnly: true })).toBe('t=1; HttpOnly')
  })

  it('name 两侧空白被裁剪，value 原样保留（含 = 与引号）', () => {
    expect(serializeCookieToRaw({ name: '  t  ', value: ' 1 ' })).toBe('t= 1 ')
    expect(serializeCookieToRaw({ name: 'sid', value: 'a=b"c' })).toBe('sid=a=b"c')
    expect(serializeCookieToRaw({ name: 't', value: 'x;y' })).toBe('t=x;y')
  })

  it('name 为空时返回空串（不产出 parse 端会拒绝的 =value），value 为空仍可序列化', () => {
    // 旧代码只看「name 与 value 同时为空」，name 空而 value 非空时会输出 `=1`；
    // parse 端的 eqIdx <= 0 会拒绝它 —— 序列化↔解析不闭环。
    expect(serializeCookieToRaw({ name: '', value: '1' }, 'header')).toBe('')
    expect(serializeCookieToRaw({ name: '', value: '1' })).toBe('')
    expect(serializeCookieToRaw({ name: '  ', value: '1' })).toBe('')
    // value 为空但 name 合法仍可序列化，parse 端也能读回
    expect(serializeCookieToRaw({ name: 't', value: '' }, 'header')).toBe('t=')
  })

  it('header 格式忽略所有属性，只保留 name=value', () => {
    expect(
      serializeCookieToRaw(
        {
          name: 't',
          value: '1',
          domain: 'example.com',
          path: '/api',
          secure: true,
          httpOnly: true,
        },
        'header',
      ),
    ).toBe('t=1')
  })

  it('json 格式按对象序列化：undefined 字段被丢弃，全空对象输出 {}', () => {
    const raw = serializeCookieToRaw({ name: 't', value: '1', domain: undefined }, 'json')
    expect(JSON.parse(raw)).toEqual({ name: 't', value: '1' })
    expect(raw).not.toContain('domain')
    expect(serializeCookieToRaw({}, 'json')).toBe('{}')
    // json 分支不参与「全空返回空串」的早退
    expect(JSON.parse(serializeCookieToRaw({ name: '', value: '' }, 'json'))).toEqual({
      name: '',
      value: '',
    })
  })

  it('带过期时间与全部属性的 Set-Cookie 串可被 parseRawCookie 无损读回', () => {
    const exp = Date.UTC(2031, 5, 15, 12, 30, 45) / 1000
    const raw = serializeCookieToRaw({
      name: 'sid',
      value: 'v=1',
      domain: 'example.com',
      path: '/api',
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      expirationDate: exp,
    })
    expect(cookiesOf(raw)[0]).toMatchObject({
      name: 'sid',
      value: 'v=1',
      domain: 'example.com',
      path: '/api',
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      expirationDate: exp,
    })
  })

  it('往返：expirationDate=0 不再丢失，unspecified 仍退化成 lax', () => {
    // 0 输出 Expires 后能原样解析回 0（旧代码序列化时丢掉，读回是会话 Cookie）
    const zeroExp = cookiesOf(serializeCookieToRaw({ name: 't', value: '1', expirationDate: 0 }))
    expect(zeroExp[0].expirationDate).toBe(0)

    const unspecified = cookiesOf(
      serializeCookieToRaw({ name: 't', value: '1', sameSite: 'unspecified' }),
    )
    expect(unspecified[0].sameSite).toBe('lax')

    // SameSite=None 没带 Secure 时，解析端会补上 Secure（安全的保守行为）
    const none = cookiesOf(
      serializeCookieToRaw({ name: 't', value: '1', sameSite: 'no_restriction' }),
    )
    expect(none[0]).toMatchObject({ sameSite: 'no_restriction', secure: true })
  })

  it('超长 value（10 万字符）序列化与解析都不截断', () => {
    const long = 'x'.repeat(100_000)
    const raw = serializeCookieToRaw({ name: 'big', value: long })
    expect(raw).toBe(`big=${long}`)
    const back = cookiesOf(raw)
    expect(back).toHaveLength(1)
    expect(back[0].value).toBe(long)
  })
})

describe('parseRawCookie：文本模式边界', () => {
  it('按行拆分，兼容 \\n / \\r\\n / 行首行尾空白，非法行只丢自己', () => {
    expect(cookiesOf('a=1\r\n  b=2  \n\tc=3').map((c) => [c.name, c.value])).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
    ])
    expect(cookiesOf('这不是 cookie\na=1').map((c) => c.name)).toEqual(['a'])
  })

  it('Cookie: / Set-Cookie: 前缀大小写不敏感', () => {
    expect(cookiesOf('Cookie: a=1; b=2').map((c) => c.name)).toEqual(['a', 'b'])
    expect(cookiesOf('COOKIE: a=1').map((c) => c.name)).toEqual(['a'])
    expect(cookiesOf('cookie: a=1').map((c) => c.name)).toEqual(['a'])
    expect(cookiesOf('SET-COOKIE: a=1; Secure')[0]).toMatchObject({ name: 'a', secure: true })
  })

  it('值里的 = 全部保留，只按第一个 = 切分', () => {
    expect(cookiesOf('token=a=b=c')[0]).toMatchObject({ name: 'token', value: 'a=b=c' })
    expect(cookiesOf('Cookie: token=a=b=c; lang=zh').map((c) => [c.name, c.value])).toEqual([
      ['token', 'a=b=c'],
      ['lang', 'zh'],
    ])
  })

  it('值里的引号与空格原样保留；引号内的分号不再被误切（回归）', () => {
    expect(cookiesOf('token="abc def"')[0].value).toBe('"abc def"')
    // 回归：切分改为引号感知，`note="a;b"` 的值完整保留；修复前会被按 ; 硬切成 '"a' 且丢掉另一段
    const quoted = cookiesOf('note="a;b"')
    expect(quoted).toHaveLength(1)
    expect(quoted[0]).toMatchObject({ name: 'note', value: '"a;b"' })
  })

  it('同名 Cookie 不去重，顺序与输入一致（domain/path 不同时尤其重要）', () => {
    expect(cookiesOf('a=1; a=2').map((c) => c.value)).toEqual(['1', '2'])
    expect(cookiesOf('a=1\na=2').map((c) => c.value)).toEqual(['1', '2'])
  })

  it('空 value、name/value 两侧空白、空片段都能正确处理', () => {
    expect(cookiesOf('a=')[0]).toMatchObject({ name: 'a', value: '' })
    expect(cookiesOf('  a  =  1  ')[0]).toMatchObject({ name: 'a', value: '1' })
    // 无 = 的片段被跳过，合法的照常保留
    expect(cookiesOf('a=1; orphan').map((c) => c.name)).toEqual(['a'])
    expect(cookiesOf('; ;;a=1;;')[0]).toMatchObject({ name: 'a', value: '1' })
  })

  it('整行没有 name=value（只有属性 / 拼不成键值）时给出 rawErrorNoPairs', () => {
    expect(errorOf('Secure; HttpOnly')).toBe(i18n.t('tool.storage.rawErrorNoPairs'))
    expect(errorOf('; Secure')).toBe(i18n.t('tool.storage.rawErrorNoPairs'))
    expect(errorOf('a; b')).toBe(i18n.t('tool.storage.rawErrorNoPairs'))
    // '=1' 的 = 在下标 0，同样不算合法键值对
    expect(errorOf('=1')).toBe(i18n.t('tool.storage.rawErrorNoPairs'))
  })

  it('已知属性名出现在非首个片段时，整行按单条 Set-Cookie 解析（现状歧义点）', () => {
    const one = cookiesOf('lang=zh; secure')
    expect(one).toHaveLength(1)
    expect(one[0]).toMatchObject({ name: 'lang', value: 'zh', secure: true, path: '/' })
    // 两段都是普通键值时才按多项解析
    expect(cookiesOf('lang=zh; theme=dark').map((c) => c.name)).toEqual(['lang', 'theme'])
  })

  it('Secure / HttpOnly 有无取值都算 true，大小写不敏感', () => {
    expect(cookiesOf('a=1; SECURE; HTTPONLY')[0]).toMatchObject({ secure: true, httpOnly: true })
    expect(cookiesOf('a=1; secure=1; httponly=yes')[0]).toMatchObject({
      secure: true,
      httpOnly: true,
    })
  })

  it('未支持的属性（Priority / Partitioned）被忽略，不影响其它字段', () => {
    expect(cookiesOf('a=1; Priority=High; Partitioned')[0]).toMatchObject({
      name: 'a',
      value: '1',
      secure: false,
    })
    // 无值的属性同样被忽略，path / domain 保持默认
    expect(cookiesOf('a=1; Path; Domain', 'd.test', '/app')[0]).toMatchObject({
      path: '/app',
      domain: 'd.test',
    })
  })

  it('SameSite 取值映射：大小写不敏感、未知值退化为 unspecified、空值回落到 lax', () => {
    const table: [string, string][] = [
      ['Lax', 'lax'],
      ['STRICT', 'strict'],
      ['none', 'no_restriction'],
      ['no_restriction', 'no_restriction'],
      ['bogus', 'unspecified'],
      ['', 'lax'],
    ]
    for (const [input, expected] of table) {
      expect(cookiesOf(`a=1; SameSite=${input}`)[0].sameSite, `SameSite=${input}`).toBe(expected)
    }
  })

  it('SameSite=None 强制 secure，即使没写 Secure 属性', () => {
    expect(cookiesOf('a=1; SameSite=none')[0].secure).toBe(true)
    expect(cookiesOf('a=1; SameSite=None; Secure')[0].secure).toBe(true)
  })

  it('Expires 合法则换算成秒，非法则留空（会话 Cookie）', () => {
    const exp = Date.UTC(2031, 5, 15, 12, 30, 45) / 1000
    expect(cookiesOf('a=1; Expires=Wed, 15 Jun 2031 12:30:45 GMT')[0].expirationDate).toBe(exp)
    expect(cookiesOf('a=1; Expires=not-a-date')[0].expirationDate).toBeUndefined()
  })

  it('Max-Age 相对当前时间换算，0 / 负数 / 非法值各自处理', () => {
    const before = Math.floor(Date.now() / 1000)
    const zero = cookiesOf('a=1; Max-Age=0')[0].expirationDate ?? 0
    expect(zero).toBeGreaterThanOrEqual(before)
    expect(zero).toBeLessThanOrEqual(before + 1)

    const negative = cookiesOf('a=1; Max-Age=-60')[0].expirationDate ?? 0
    expect(negative).toBeGreaterThanOrEqual(before - 60)
    expect(negative).toBeLessThanOrEqual(before - 59)

    const spaced = cookiesOf('a=1; Max-Age=  3600  ')[0].expirationDate ?? 0
    expect(spaced).toBeGreaterThanOrEqual(before + 3599)
    expect(spaced).toBeLessThanOrEqual(before + 3601)

    // 非数字直接忽略，不写入 NaN
    expect(cookiesOf('a=1; Max-Age=abc')[0].expirationDate).toBeUndefined()
  })

  it('Expires 与 Max-Age 同时出现时后写的 wins（按属性顺序覆盖）', () => {
    const exp = Date.UTC(2031, 5, 15, 12, 30, 45) / 1000
    const expiresFirst =
      cookiesOf('a=1; Expires=Wed, 15 Jun 2031 12:30:45 GMT; Max-Age=60')[0].expirationDate ?? 0
    expect(expiresFirst).toBeLessThan(exp)

    const maxAgeFirst = cookiesOf('a=1; Max-Age=60; Expires=Wed, 15 Jun 2031 12:30:45 GMT')[0]
      .expirationDate
    expect(maxAgeFirst).toBe(exp)
  })

  it('默认 domain/path 只补缺省值，显式声明（含前导点）被保留', () => {
    expect(cookiesOf('a=1; b=2', 'd.test', '/app').every((c) => c.domain === 'd.test')).toBe(true)
    expect(cookiesOf('a=1; Domain=.example.com; Path=/api')[0]).toMatchObject({
      domain: '.example.com',
      path: '/api',
    })
    // 不传 defaultDomain 时 domain 为 undefined（表示交给 background 推断）
    expect(cookiesOf('a=1')[0].domain).toBeUndefined()
  })
})

describe('parseRawCookie：JSON 模式边界', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('缺少 name / name 只有空白 → rawErrorJsonMissingName（中英一致）', () => {
    expect(errorOf('[{"value":"1"}]')).toBe(i18n.t('tool.storage.rawErrorJsonMissingName'))
    expect(errorOf('{"value":"1"}')).toBe(i18n.t('tool.storage.rawErrorJsonMissingName'))
    expect(errorOf('[{"name":"   "}]')).toBe(i18n.t('tool.storage.rawErrorJsonMissingName'))
  })

  it('条目不是对象（数字 / 字符串 / null）→ rawErrorJsonItemInvalid', () => {
    for (const raw of ['[1, 2]', '["a"]', '[null]', '[{"name":"a"},2]']) {
      expect(errorOf(raw), raw).toBe(i18n.t('tool.storage.rawErrorJsonItemInvalid'))
    }
  })

  it('空数组 → rawErrorJsonArrayEmpty', () => {
    expect(errorOf('[]')).toBe(i18n.t('tool.storage.rawErrorJsonArrayEmpty'))
    expect(errorOf('  [ ]  ')).toBe(i18n.t('tool.storage.rawErrorJsonArrayEmpty'))
  })

  it('name / value 的别名与类型转换：key / Name / 数字 name / null value', () => {
    const res = cookiesOf('[{"key":"k","value":null},{"Name":"n"},{"name":5,"Value":"v"}]')
    expect(res.map((c) => [c.name, c.value])).toEqual([
      ['k', ''],
      ['n', ''],
      ['5', 'v'],
    ])
  })

  it('domain / path：null 用默认值，空串与数字按字面处理', () => {
    expect(
      cookiesOf('[{"name":"a","domain":null,"path":null}]', 'd.test', '/app')[0],
    ).toMatchObject({ domain: 'd.test', path: '/app' })
    expect(cookiesOf('[{"name":"a","domain":"","path":""}]', 'd.test', '/app')[0]).toMatchObject({
      domain: '',
      path: '',
    })
    expect(cookiesOf('[{"name":"a","domain":123,"path":456}]')[0]).toMatchObject({
      domain: '123',
      path: '456',
    })
    // 两侧空白会被裁剪（带前导点的 domain 不受影响）
    expect(cookiesOf('[{"name":"a","domain":" .example.com "}]')[0].domain).toBe('.example.com')
  })

  it('secure 采用真值转换；SameSite=None 时无条件强制 secure', () => {
    expect(cookiesOf('[{"name":"a","secure":"yes"}]')[0].secure).toBe(true)
    expect(cookiesOf('[{"name":"a","secure":0}]')[0].secure).toBe(false)
    expect(cookiesOf('[{"name":"a","secure":false,"sameSite":"none"}]')[0].secure).toBe(true)
  })

  it('httpOnly 与 httponly 同时出现时前者优先（?? 只看第一个非空值）', () => {
    expect(cookiesOf('[{"name":"a","httpOnly":true}]')[0].httpOnly).toBe(true)
    expect(cookiesOf('[{"name":"a","httponly":true}]')[0].httpOnly).toBe(true)
    expect(cookiesOf('[{"name":"a","httpOnly":false,"httponly":true}]')[0].httpOnly).toBe(false)
    expect(cookiesOf('[{"name":"a","httpOnly":null,"httponly":true}]')[0].httpOnly).toBe(true)
  })

  it('SameSite 未知值 / 未提供 / 数字都落到 safe 默认', () => {
    expect(cookiesOf('[{"name":"a","sameSite":"bogus"}]')[0].sameSite).toBe('unspecified')
    expect(cookiesOf('[{"name":"a"}]')[0].sameSite).toBe('lax')
    expect(cookiesOf('[{"name":"a","sameSite":5}]')[0].sameSite).toBe('unspecified')
  })

  it('expirationDate 优先级：expirationDate > expires(number) > expires(string)，且都取整', () => {
    expect(cookiesOf('[{"name":"a","expirationDate":1893456000.9}]')[0].expirationDate).toBe(
      1893456000,
    )
    expect(
      cookiesOf('[{"name":"a","expirationDate":1893456000,"expires":1}]')[0].expirationDate,
    ).toBe(1893456000)
    expect(cookiesOf('[{"name":"a","expires":1893456000.5}]')[0].expirationDate).toBe(1893456000)
    expect(
      cookiesOf('[{"name":"a","expires":"Wed, 15 Jun 2031 12:30:45 GMT"}]')[0].expirationDate,
    ).toBe(Date.UTC(2031, 5, 15, 12, 30, 45) / 1000)
  })

  it('非法的过期时间不写入字段（字符串形式的 expirationDate 不被支持）', () => {
    expect(cookiesOf('[{"name":"a","expires":"not-a-date"}]')[0].expirationDate).toBeUndefined()
    expect(
      cookiesOf('[{"name":"a","expirationDate":"1893456000"}]')[0].expirationDate,
    ).toBeUndefined()
    expect(cookiesOf('[{"name":"a","expirationDate":null}]')[0].expirationDate).toBeUndefined()
  })

  it('JSON 数组里的同名条目全部保留且顺序不变', () => {
    expect(
      cookiesOf('[{"name":"a","value":"1"},{"name":"a","value":"2"}]').map((c) => c.value),
    ).toEqual(['1', '2'])
  })

  it('JSON 语法错误 → rawErrorJsonSyntax，且 detail 已完成插值', async () => {
    await i18n.changeLanguage('en')
    for (const raw of ['{bad json', '{"name":"a",}', '[{]']) {
      const error = errorOf(raw)
      expect(error, raw).toMatch(/^JSON syntax error: .+/)
      expect(error, raw).not.toContain('{{')
    }
  })

  it('顶层 JSON 不是对象/数组（null / true / 数字 / 字符串）落到文本模式并报 rawErrorNoPairs', () => {
    for (const raw of ['null', 'true', '123', '"abc"']) {
      expect(errorOf(raw), raw).toBe(i18n.t('tool.storage.rawErrorNoPairs'))
    }
  })
})

describe('parseRawCookie：错误码与语言包一一对应', () => {
  const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/
  /** 输入 → 期望命中的 i18n key（syntax 用前缀校验，因为带 detail 插值） */
  const cases: [string, string][] = [
    ['   ', 'tool.storage.errorEmpty'],
    ['[]', 'tool.storage.rawErrorJsonArrayEmpty'],
    ['[1]', 'tool.storage.rawErrorJsonItemInvalid'],
    ['[{"value":"1"}]', 'tool.storage.rawErrorJsonMissingName'],
    ['这不是 cookie', 'tool.storage.rawErrorNoPairs'],
  ]

  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('英文界面下命中英文模板，中文界面下命中中文模板，且两者不同', async () => {
    for (const [input, key] of cases) {
      await i18n.changeLanguage('en')
      const enText = errorOf(input)
      expect(enText, input).toBe(i18n.t(key))
      expect(CJK.test(enText), `英文文案含中文：${enText}`).toBe(false)

      await i18n.changeLanguage('zh')
      const zhText = errorOf(input)
      expect(zhText, input).toBe(i18n.t(key))
      expect(CJK.test(zhText), `中文文案异常：${zhText}`).toBe(true)
      expect(zhText, `${input} 中英文案相同（可能漏翻）`).not.toBe(enText)
    }
  })

  it('JSON 语法错误的中英文案都带原始 detail，且不留占位符', async () => {
    await i18n.changeLanguage('en')
    const enText = errorOf('{bad json')
    expect(enText.startsWith(`${i18n.t('tool.storage.rawErrorJsonSyntax', { detail: '' })}`)).toBe(
      true,
    )
    expect(enText).not.toContain('{{')
    expect(CJK.test(enText)).toBe(false)

    await i18n.changeLanguage('zh')
    const zhText = errorOf('{bad json')
    expect(zhText.startsWith(`${i18n.t('tool.storage.rawErrorJsonSyntax', { detail: '' })}`)).toBe(
      true,
    )
    expect(zhText).not.toContain('{{')
    expect(CJK.test(zhText)).toBe(true)
  })
})
