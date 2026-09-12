import { describe, expect, it } from 'vitest'

import { buildUrl, decodeUrl, encodeUrl, extractUrlFromText, flattenParams, parseUrl } from './url'

describe('encodeUrl / decodeUrl', () => {
  it('组件模式编码全部特殊字符', () => {
    expect(encodeUrl('a b&c=d?e', 'component')).toEqual({ ok: true, text: 'a%20b%26c%3Dd%3Fe' })
  })

  it('完整网址模式保留协议与路径分隔符', () => {
    const res = encodeUrl('https://a.com/路径?x=1&y=2', 'full')
    expect(res).toEqual({ ok: true, text: 'https://a.com/%E8%B7%AF%E5%BE%84?x=1&y=2' })
  })

  it('空串原样返回成功', () => {
    expect(encodeUrl('', 'component')).toEqual({ ok: true, text: '' })
    expect(decodeUrl('', 'component')).toEqual({ ok: true, text: '' })
  })

  it('解码百分号编码的中文', () => {
    expect(decodeUrl('%E4%BD%A0%E5%A5%BD', 'component')).toEqual({ ok: true, text: '你好' })
  })

  it('畸形 % 序列返回 ok:false 并标记 isMalformed，而不是抛错', () => {
    // %E4%BD 是截断的三字节 UTF-8 序列；%ZZ 不是合法转义
    for (const bad of ['%E4%BD', '%ZZ']) {
      const res = decodeUrl(bad, 'component')
      expect(res.ok, `${bad} 应解码失败`).toBe(false)
      if (!res.ok) expect(res.isMalformed).toBe(true)
    }
  })

  it('孤立代理对编码失败时返回 ok:false，而不是抛错', () => {
    const res = encodeUrl('\uD800', 'component')
    expect(res.ok).toBe(false)
  })
})

describe('buildUrl', () => {
  it('localhost 与 IPv4 自动补 http', () => {
    expect(buildUrl('localhost:3000/x').href).toBe('http://localhost:3000/x')
    expect(buildUrl('127.0.0.1:8080').href).toBe('http://127.0.0.1:8080/')
  })

  it('无协议域名补 https', () => {
    expect(buildUrl('example.com/path').href).toBe('https://example.com/path')
  })

  it('相对路径按给定 base 解析', () => {
    expect(buildUrl('/a/b', 'https://base.com/x/y').href).toBe('https://base.com/a/b')
  })

  it('拒绝非白名单协议（含 javascript: 伪协议）', () => {
    expect(() => buildUrl('httpas://example.com')).toThrow()
    expect(() => buildUrl('javascript:alert(1)')).toThrow()
  })
})

describe('extractUrlFromText', () => {
  it('从自然语言中抽取网址并去掉尾部标点', () => {
    expect(extractUrlFromText('参见 https://a.com/x, 然后继续')).toBe('https://a.com/x')
  })

  it('无网址时返回 null', () => {
    expect(extractUrlFromText('这里没有链接')).toBeNull()
  })
})

describe('flattenParams', () => {
  it('数组用下标记法、嵌套对象用括号记法', () => {
    expect(flattenParams({ a: '1', b: ['2', '3'], c: { d: '4', e: ['5'] } })).toEqual([
      { key: 'a', value: '1' },
      { key: 'b[0]', value: '2' },
      { key: 'b[1]', value: '3' },
      { key: 'c[d]', value: '4' },
      { key: 'c[e][0]', value: '5' },
    ])
  })
})

describe('parseUrl', () => {
  it('抽取网址并拆解出全部组成部分', () => {
    const res = parseUrl('看看 https://u:p@example.com:8443/a/b?x=1#frag 这个')
    expect(res.url.href).toBe('https://u:p@example.com:8443/a/b?x=1#frag')
    const map = Object.fromEntries(res.parts.map((p) => [p.key, p.value]))
    expect(map.protocol).toBe('https:')
    expect(map.host).toBe('example.com:8443')
    expect(map.port).toBe('8443')
    expect(map.path).toBe('/a/b')
    expect(map.search).toBe('?x=1')
    expect(map.hash).toBe('#frag')
    expect(map.username).toBe('u')
    expect(map.password).toBe('p')
  })

  it('查询参数扁平化为 kv 列表', () => {
    const res = parseUrl('https://a.com/?x=1&x=2&filter[name]=n')
    expect(res.params).toEqual([
      { key: 'x[0]', value: '1' },
      { key: 'x[1]', value: '2' },
      { key: 'filter[name]', value: 'n' },
    ])
  })

  it('省略根路径时不产生无意义的空 path 项', () => {
    const res = parseUrl('https://a.com')
    expect(res.parts.map((p) => p.key)).not.toContain('path')
    expect(res.parts.map((p) => p.key)).not.toContain('search')
  })
})
