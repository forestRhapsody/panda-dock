import { describe, expect, it } from 'vitest'

import {
  ALLOWED_PROTOCOLS,
  buildUrl,
  decodeUrl,
  encodeUrl,
  extractUrlFromText,
  flattenParams,
  parseUrl,
} from './url'
import type { CodecScope } from './url'

describe('ALLOWED_PROTOCOLS', () => {
  it('白名单只含常见网络协议，不含 javascript / data / blob', () => {
    expect([...ALLOWED_PROTOCOLS].sort()).toEqual([
      'file:',
      'ftp:',
      'http:',
      'https:',
      'ws:',
      'wss:',
    ])
    for (const bad of ['javascript:', 'data:', 'blob:', 'chrome:']) {
      expect(ALLOWED_PROTOCOLS.has(bad), bad).toBe(false)
    }
  })
})

describe('extractUrlFromText', () => {
  it('支持 http / https / ftp / ws / wss / file 六种协议', () => {
    const urls = [
      'http://a.com/x',
      'https://a.com/x',
      'ftp://a.com/x',
      'ws://a.com/socket',
      'wss://a.com/socket',
      'file:///tmp/a.txt',
    ]
    for (const url of urls) expect(extractUrlFromText(`前缀 ${url} 后缀`), url).toBe(url)
  })

  it('协议大小写不敏感，且保留原始大小写', () => {
    expect(extractUrlFromText('HTTPS://A.COM/Path')).toBe('HTTPS://A.COM/Path')
    expect(extractUrlFromText('WSS://A.COM/s')).toBe('WSS://A.COM/s')
  })

  it('遇到空白 / 引号 / 尖括号 / 反引号 / 中文即停止', () => {
    expect(extractUrlFromText('https://a.com/x 后面还有字')).toBe('https://a.com/x')
    expect(extractUrlFromText('"https://a.com/x"')).toBe('https://a.com/x')
    expect(extractUrlFromText("'https://a.com/x'")).toBe('https://a.com/x')
    expect(extractUrlFromText('<https://a.com/x>')).toBe('https://a.com/x')
    expect(extractUrlFromText('`https://a.com/x`')).toBe('https://a.com/x')
    expect(extractUrlFromText('https://a.com/中文路径')).toBe('https://a.com/')
  })

  it('去掉尾部标点（半角与全角）', () => {
    expect(extractUrlFromText('见 (https://a.com/x).')).toBe('https://a.com/x')
    expect(extractUrlFromText('https://a.com/x!?')).toBe('https://a.com/x')
    expect(extractUrlFromText('https://a.com/x。')).toBe('https://a.com/x')
    expect(extractUrlFromText('https://a.com/x，')).toBe('https://a.com/x')
  })

  it('查询串与 hash 属于网址的一部分并保序保留', () => {
    expect(extractUrlFromText('https://a.com/p?b=2&a=1#frag')).toBe('https://a.com/p?b=2&a=1#frag')
  })

  it('多个网址时只取第一个', () => {
    expect(extractUrlFromText('https://a.com/1 与 https://b.com/2')).toBe('https://a.com/1')
  })

  it('没有网址或协议不完整时返回 null', () => {
    expect(extractUrlFromText('这里没有链接')).toBeNull()
    expect(extractUrlFromText('')).toBeNull()
    expect(extractUrlFromText('http:/a.com')).toBeNull()
    expect(extractUrlFromText('https://')).toBeNull()
    expect(extractUrlFromText('example.com')).toBeNull()
    expect(extractUrlFromText('javascript:alert(1)')).toBeNull()
  })
})

describe('buildUrl', () => {
  it('绝对 URL 直接返回并按 URL 规范归一化（大小写 / 默认端口 / 路径）', () => {
    expect(buildUrl('HTTPS://A.COM:443/a').href).toBe('https://a.com/a')
    expect(buildUrl('ftp://a.com/x').protocol).toBe('ftp:')
    expect(buildUrl('file:///tmp/a.txt').href).toBe('file:///tmp/a.txt')
    expect(buildUrl('https://u:p@a.com/x').href).toBe('https://u:p@a.com/x')
  })

  it('无 scheme 的 localhost / IPv4 补 http，域名补 https', () => {
    expect(buildUrl('localhost').href).toBe('http://localhost/')
    expect(buildUrl('localhost:3000/x?y=1#h').href).toBe('http://localhost:3000/x?y=1#h')
    expect(buildUrl('127.0.0.1:8080').href).toBe('http://127.0.0.1:8080/')
    expect(buildUrl('example.com/path').href).toBe('https://example.com/path')
    expect(buildUrl('sub.example.com:8443/p').href).toBe('https://sub.example.com:8443/p')
    expect(buildUrl('xn--fiqs8s.com').href).toBe('https://xn--fiqs8s.com/')
  })

  it('相对路径以给定 base 解析（含 ./ .. .hidden）', () => {
    expect(buildUrl('/a/b', 'https://base.com/x/y').href).toBe('https://base.com/a/b')
    expect(buildUrl('./c', 'https://base.com/x/y').href).toBe('https://base.com/x/c')
    expect(buildUrl('../..', 'https://base.com/x/y').href).toBe('https://base.com/')
    expect(buildUrl('.hidden', 'https://base.com/x/y').href).toBe('https://base.com/x/.hidden')
  })

  it('测试环境（node，无 window）默认 base 为 http://localhost/', () => {
    // 覆盖 currentBase() 的 typeof window === 'undefined' 降级分支
    expect(buildUrl('/a/b').href).toBe('http://localhost/a/b')
    // 协议相对地址会沿用 base 的 scheme
    expect(buildUrl('//example.com/x').href).toBe('http://example.com/x')
  })

  it('拒绝非白名单协议与非法 host / 端口', () => {
    for (const bad of [
      'httpas://example.com',
      'javascript:alert(1)',
      'data:text/plain,hi',
      'blob:https://a.com/x',
    ]) {
      expect(() => buildUrl(bad), bad).toThrow('invalid')
    }
    expect(() => buildUrl('example.c')).toThrow('invalid') // TLD 至少 2 个字母
    expect(() => buildUrl('my_host.com')).toThrow('invalid') // 下划线不合法
    expect(() => buildUrl('999.999.999.999')).toThrow('invalid') // 越界 IPv4
    expect(() => buildUrl('https://a.com:99999')).toThrow('invalid') // 端口越界
    expect(() => buildUrl('')).toThrow('invalid')
    expect(() => buildUrl(' example.com ')).toThrow('invalid') // buildUrl 自身不做 trim
  })

  it('非法 base 会让相对路径解析失败并抛错', () => {
    expect(() => buildUrl('/a', 'not-a-base')).toThrow('invalid')
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

  it('空对象 / 空数组 / 空嵌套对象不产生任何行', () => {
    expect(flattenParams({})).toEqual([])
    expect(flattenParams({ a: [], b: {}, c: { d: [] } })).toEqual([])
  })

  it('数组里再嵌套对象 / 数组时继续展开', () => {
    expect(flattenParams({ a: [{ b: '1' }], c: [['x']] })).toEqual([
      { key: 'a[0][b]', value: '1' },
      { key: 'c[0][0]', value: 'x' },
    ])
  })

  it('null / undefined / 数字 / 布尔值统一转字符串（含 0 与 false）', () => {
    expect(flattenParams({ a: null, b: undefined, c: 0, d: false })).toEqual([
      { key: 'a', value: 'null' },
      { key: 'b', value: 'undefined' },
      { key: 'c', value: '0' },
      { key: 'd', value: 'false' },
    ])
  })

  it('保持插入顺序，key 里的方括号原样保留', () => {
    expect(flattenParams({ b: '2', 'a[b]': '1', z: { y: '3', x: '4' } })).toEqual([
      { key: 'b', value: '2' },
      { key: 'a[b]', value: '1' },
      { key: 'z[y]', value: '3' },
      { key: 'z[x]', value: '4' },
    ])
  })
})

describe('parseUrl', () => {
  it('从文本中抽取网址并拆解出全部组成部分', () => {
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

  it('parts 按固定顺序输出', () => {
    const res = parseUrl('https://u:p@example.com:8443/a/b?x=1#frag')
    expect(res.parts.map((p) => p.key)).toEqual([
      'protocol',
      'origin',
      'host',
      'port',
      'path',
      'search',
      'hash',
      'username',
      'password',
    ])
  })

  it('根路径 / 默认端口 / 空 origin 不产生无意义的空列', () => {
    const https = parseUrl('https://a.com:443')
    expect(https.parts.map((p) => p.key)).toEqual(['protocol', 'origin', 'host'])

    // file: 的 origin 是字符串 "null"，按源码约定不展示
    const file = parseUrl('file:///tmp/a.txt')
    expect(file.parts.map((p) => p.key)).toEqual(['protocol', 'path'])
    expect(file.parts.find((p) => p.key === 'origin')).toBeUndefined()
  })

  it('query 用 qs 解析后扁平化：重复参数、数组、嵌套、无值 key', () => {
    expect(parseUrl('https://a.com/?x=1&x=2').params).toEqual([
      { key: 'x[0]', value: '1' },
      { key: 'x[1]', value: '2' },
    ])
    expect(parseUrl('https://a.com/?a[]=1&a[]=2').params).toEqual([
      { key: 'a[0]', value: '1' },
      { key: 'a[1]', value: '2' },
    ])
    expect(parseUrl('https://a.com/?filter[name]=n&filter[age]=1').params).toEqual([
      { key: 'filter[name]', value: 'n' },
      { key: 'filter[age]', value: '1' },
    ])
    expect(parseUrl('https://a.com/?flag').params).toEqual([{ key: 'flag', value: '' }])
    expect(parseUrl('https://a.com/?x=1&x=').params).toEqual([
      { key: 'x[0]', value: '1' },
      { key: 'x[1]', value: '' },
    ])
  })

  it('query 值的百分号解码、+ 号解码与畸形 % 序列的降级', () => {
    expect(parseUrl('https://a.com/?q=%E4%BD%A0%E5%A5%BD').params).toEqual([
      { key: 'q', value: '你好' },
    ])
    expect(parseUrl('https://a.com/?q=a+b').params).toEqual([{ key: 'q', value: 'a b' }])
    // qs 对解码失败的片段原样保留，不抛错
    expect(parseUrl('https://a.com/?q=%E4%BD').params).toEqual([{ key: 'q', value: '%E4%BD' }])
  })

  it('__proto__ 之类的键不会污染 Object 原型', () => {
    const res = parseUrl('https://a.com/?__proto__[polluted]=1')
    expect(res.params.some((p) => p.value === '1')).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('hash 只出现在 hash 项，不参与 query 解析', () => {
    const res = parseUrl('https://a.com/?x=1#y=2')
    expect(res.params).toEqual([{ key: 'x', value: '1' }])
    expect(res.parts.find((p) => p.key === 'hash')?.value).toBe('#y=2')
  })

  it('无 query 时 params 为空数组', () => {
    expect(parseUrl('https://a.com/a/b').params).toEqual([])
    expect(parseUrl('https://a.com/#frag').params).toEqual([])
  })

  it('输入前后空白被忽略，纯文本中的网址优先', () => {
    expect(parseUrl('   https://a.com/x   ').url.href).toBe('https://a.com/x')
    expect(parseUrl('看这里 https://a.com/x 谢谢').url.href).toBe('https://a.com/x')
  })

  it('base 参与相对路径解析', () => {
    expect(parseUrl('/a/b?x=1', 'https://base.com/dir/page').url.href).toBe(
      'https://base.com/a/b?x=1',
    )
  })

  it('无法解析的输入抛错（由调用方兜底）', () => {
    expect(() => parseUrl('不是网址')).toThrow('invalid')
    expect(() => parseUrl('')).toThrow('invalid')
    expect(() => parseUrl('   ')).toThrow('invalid')
  })
})

describe('encodeUrl', () => {
  it('component 模式编码全部特殊字符，full 模式保留 URL 结构字符', () => {
    expect(encodeUrl('a b&c=d?e', 'component')).toEqual({ ok: true, text: 'a%20b%26c%3Dd%3Fe' })
    expect(encodeUrl('a b&c=d?e', 'full')).toEqual({ ok: true, text: 'a%20b&c=d?e' })
    expect(encodeUrl('https://a.com/路径?x=1&y=2', 'full')).toEqual({
      ok: true,
      text: 'https://a.com/%E8%B7%AF%E5%BE%84?x=1&y=2',
    })
  })

  it("component 模式保留 !'()*-._~ 等非保留字符", () => {
    expect(encodeUrl("!'()*-._~", 'component')).toEqual({ ok: true, text: "!'()*-._~" })
  })

  it('中文、空白、换行按 UTF-8 百分号编码', () => {
    expect(encodeUrl('中文', 'component')).toEqual({ ok: true, text: '%E4%B8%AD%E6%96%87' })
    expect(encodeUrl('a\nb\tc', 'component')).toEqual({ ok: true, text: 'a%0Ab%09c' })
  })

  it('已编码的 % 会被再次编码（不做幂等判断）', () => {
    expect(encodeUrl('%20', 'component')).toEqual({ ok: true, text: '%2520' })
  })

  it('空串直接返回成功空串（两种 scope 一致）', () => {
    expect(encodeUrl('', 'component')).toEqual({ ok: true, text: '' })
    expect(encodeUrl('', 'full')).toEqual({ ok: true, text: '' })
  })

  it('孤立代理对（畸形 Unicode）返回 ok:false 而非抛错', () => {
    for (const bad of ['\uD800', '\uDC00', 'a\uD800b', '前缀\uDFFF']) {
      const res = encodeUrl(bad, 'component')
      expect(res.ok, JSON.stringify(bad)).toBe(false)
      if (!res.ok) expect(res.error.length).toBeGreaterThan(0)
    }
    expect(encodeUrl('https://a.com/\uD800', 'full').ok).toBe(false)
  })

  it('合法代理对（emoji）正常编码', () => {
    expect(encodeUrl('😀', 'component')).toEqual({ ok: true, text: '%F0%9F%98%80' })
  })

  it('未知 scope 按 component 处理', () => {
    expect(encodeUrl('a&b', 'weird' as CodecScope)).toEqual({ ok: true, text: 'a%26b' })
  })
})

describe('decodeUrl', () => {
  it('component 解码全部转义，full 保留保留字符的转义', () => {
    expect(decodeUrl('%E4%BD%A0%E5%A5%BD', 'component')).toEqual({ ok: true, text: '你好' })
    expect(decodeUrl('%2F', 'component')).toEqual({ ok: true, text: '/' })
    expect(decodeUrl('%2F', 'full')).toEqual({ ok: true, text: '%2F' })
    expect(decodeUrl('a%20b%3Fc', 'full')).toEqual({ ok: true, text: 'a b%3Fc' })
  })

  it('+ 不还原为空格（与 form 编码不同）', () => {
    expect(decodeUrl('a+b', 'component')).toEqual({ ok: true, text: 'a+b' })
    expect(decodeUrl('a+b', 'full')).toEqual({ ok: true, text: 'a+b' })
  })

  it('空串直接返回成功空串（两种 scope 一致）', () => {
    expect(decodeUrl('', 'component')).toEqual({ ok: true, text: '' })
    expect(decodeUrl('', 'full')).toEqual({ ok: true, text: '' })
  })

  it('%00 等控制字符可正常解码', () => {
    expect(decodeUrl('%00', 'component')).toEqual({ ok: true, text: '\u0000' })
  })

  it('畸形 % 序列返回 ok:false、isMalformed:true 且不抛错', () => {
    for (const scope of ['component', 'full'] as CodecScope[]) {
      for (const bad of ['%', '%ZZ', '%E4%BD', '100%']) {
        const res = decodeUrl(bad, scope)
        expect(res.ok, `${scope} ${bad}`).toBe(false)
        if (!res.ok) {
          expect(res.isMalformed, `${scope} ${bad}`).toBe(true)
          expect(res.error.length, `${scope} ${bad}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('未知 scope 按 component 处理', () => {
    expect(decodeUrl('%2F', 'weird' as CodecScope)).toEqual({ ok: true, text: '/' })
  })
})
