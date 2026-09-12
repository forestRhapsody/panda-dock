import { describe, expect, it } from 'vitest'

import { decodeBase64, encodeBase64, isLikelyBase64 } from './base64'

/**
 * base64.ts 是纯逻辑模块（TextEncoder/TextDecoder + btoa/atob），因此：
 * - 只断言真实可观察行为（输出字符串、isText 标记、抛出的错误信息），不做同义反复断言；
 * - 用「encode ∘ decode ≡ identity」验证可逆性，同时显式钉住已知有损场景（孤立代理项、BOM 剥离）；
 * - 覆盖分块边界（CHUNK = 0x8000），因为 bytesToBinary 用 subarray + 展开传参，只在超长输入时才走到多块分支。
 */

describe('encodeBase64', () => {
  it('ASCII 文本按标准字母表编码并按需补齐 padding', () => {
    expect(encodeBase64('')).toBe('')
    expect(encodeBase64('a')).toBe('YQ==')
    expect(encodeBase64('ab')).toBe('YWI=')
    expect(encodeBase64('abc')).toBe('YWJj')
    expect(encodeBase64('hello')).toBe('aGVsbG8=')
  })

  it('按 UTF-8 编码多字节字符与 emoji 代理对', () => {
    expect(encodeBase64('你好')).toBe('5L2g5aW9')
    expect(encodeBase64('é')).toBe('w6k=')
    // U+1F600 的 UTF-8 为 F0 9F 98 80，编码结果必然含 '+'，证明确实使用标准字母表
    expect(encodeBase64('😀')).toBe('8J+YgA==')
    expect(encodeBase64('😀')).toContain('+')
  })

  it('输出始终落在标准字母表内（不使用 URL-safe 的 -/_）', () => {
    // '??>' 的字节 3F 3F 3E 编码为 Pz8+，是标准字母表下的 '+' 分支
    expect(encodeBase64('??>')).toBe('Pz8+')
    for (const text of ['', 'a', '你好', '😀', 'ÿÿÿþ', '\u0000\u00ff']) {
      expect(encodeBase64(text), text).toMatch(/^[A-Za-z0-9+/]*={0,2}$/)
    }
  })

  it('孤立代理项被 TextEncoder 换成 U+FFFD（有损，不可逆）', () => {
    // 段代理（lone surrogate）不是合法 UTF-8 文本，编码阶段就会被替换，decode 无法还原
    expect(encodeBase64('\uD800')).toBe('77+9')
    const res = decodeBase64(encodeBase64('\uD800'))
    expect(res.isText).toBe(true)
    expect(res.text).toBe('\uFFFD')
    expect(res.text).not.toBe('\uD800')
  })
})

describe('decodeBase64', () => {
  it('encode ∘ decode 对合法 UTF-8 文本恒等（含空白、控制符、代理对、组合字符）', () => {
    const cases = [
      '',
      'a',
      'hello',
      '你好，世界',
      'a😀b',
      '👨‍👩‍👧‍👦',
      'e\u0301',
      'line1\nline2',
      'tab\tend',
      '\u0000\u0001\u001f',
      '{"a":1}',
      ' 前后空格 ',
      '𐍈',
      '\u2028\u2029',
      'a'.repeat(70_000),
      'é'.repeat(20_000),
    ]
    for (const text of cases) {
      const res = decodeBase64(encodeBase64(text))
      expect(res.isText, `isText 应为 true：${JSON.stringify(text.slice(0, 20))}`).toBe(true)
      expect(res.text, `往返失败：${JSON.stringify(text.slice(0, 20))}`).toBe(text)
    }
  })

  it('空串与纯空白解码为空文本且 isText 为 true', () => {
    expect(decodeBase64('')).toEqual({ text: '', isText: true })
    expect(decodeBase64('   ')).toEqual({ text: '', isText: true })
    expect(decodeBase64('\n\t\r ')).toEqual({ text: '', isText: true })
  })

  it('忽略任意位置的空白与换行（含 CRLF 与制表符）', () => {
    expect(decodeBase64('aGVs\nbG8=').text).toBe('hello')
    expect(decodeBase64(' aGVs bG8= ').text).toBe('hello')
    expect(decodeBase64('aGVs\r\nbG8=').text).toBe('hello')
    expect(decodeBase64('aGVs\tbG8=\n').text).toBe('hello')
  })

  it('兼容 URL-safe（-/_）与省略 padding 的写法', () => {
    // '???' 的标准 Base64 为 Pz8/，URL-safe 为 Pz8_
    expect(decodeBase64('Pz8/').text).toBe('???')
    expect(decodeBase64('Pz8_').text).toBe('???')
    // 省略 padding 时按 4 字符一组补位：2 字符补 '=='、3 字符补 '='
    expect(decodeBase64('YQ').text).toBe('a')
    expect(decodeBase64('YWI').text).toBe('ab')
    // URL-safe 且无 padding 的 emoji
    expect(decodeBase64('8J-YgA')).toEqual({ text: '😀', isText: true })
  })

  it('URL-safe 变体与标准写法解码结果完全一致', () => {
    const std = encodeBase64('😀')
    const urlSafe = std.replace(/\+/g, '-').replace(/\//g, '_')
    expect(decodeBase64(std)).toEqual(decodeBase64(urlSafe))
    expect(decodeBase64(std.replace(/=+$/, ''))).toEqual(decodeBase64(std))
    expect(decodeBase64(urlSafe.replace(/=+$/, ''))).toEqual(decodeBase64(std))
  })

  it('长度模 4 余 1 属非法长度并抛出固定中文错误', () => {
    for (const bad of ['a', 'AAAAA', 'abcdefghi']) {
      expect(() => decodeBase64(bad), bad).toThrow('不是有效的 Base64：字符集或长度不正确')
    }
    // 反向对照：模 4 余 3 的 'aGVsbG8' 会补一个 '=' 后正常解码，证明上面确实校验的是长度
    expect(decodeBase64('aGVsbG8').text).toBe('hello')
  })

  it('字符集非法时在正则校验处抛出错误', () => {
    for (const bad of ['ab*d', 'a$b=', 'ab=c', '你好', 'aGVsbG8=!']) {
      expect(() => decodeBase64(bad), bad).toThrow('不是有效的 Base64：字符集或长度不正确')
    }
  })

  it('padding 数量非法（超过 2 个）同样被拒绝', () => {
    // 'aGVsbG8===' 长度为 11（模 4 余 3）能补位，但补完出现 4 个 '='，必须命中字符集校验
    expect(() => decodeBase64('aGVsbG8===')).toThrow('不是有效的 Base64：字符集或长度不正确')
    expect(() => decodeBase64('YQ====')).toThrow('不是有效的 Base64：字符集或长度不正确')
  })

  it('非 UTF-8 字节不抛错：isText=false 且按原始字节逐位展示', () => {
    // PNG 魔数 89 50 4E 47：合法 Base64，但不构成合法 UTF-8 文本
    const png = decodeBase64('iVBORw==')
    expect(png.isText).toBe(false)
    expect(png.text.length).toBe(4)
    expect(png.text.charCodeAt(0)).toBe(0x89)
    expect(png.text.slice(1)).toBe('PNG')
    // 0xFF 0xFF 也不是合法 UTF-8 序列
    expect(decodeBase64('//8=')).toEqual({ text: '\u00ff\u00ff', isText: false })
  })

  it('合法 UTF-8 但非 ASCII 的字节仍按文本解码', () => {
    expect(decodeBase64('w6k=')).toEqual({ text: 'é', isText: true })
    expect(decodeBase64('5L2g5aW9')).toEqual({ text: '你好', isText: true })
  })

  it('UTF-8 BOM 会被 TextDecoder 剥离（有损，不可逆）', () => {
    const res = decodeBase64('77u/aGVsbG8=')
    expect(res.isText).toBe(true)
    expect(res.text).toBe('hello')
    expect(res.text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('任意二进制字节序列都能往返，且 padding / URL-safe 变体结果一致', () => {
    // 用确定性伪随机字节覆盖合法/非法 UTF-8 混合场景，验证不丢字节
    const bytes = new Uint8Array(300)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    const b64 = btoa(binary)

    const base = decodeBase64(b64)
    expect(base.text.length).toBe(bytes.length)
    expect(decodeBase64(b64.replace(/=+$/, '')).text).toBe(base.text)
    expect(decodeBase64(b64.replace(/\+/g, '-').replace(/\//g, '_')).text).toBe(base.text)
  })

  it('超过 32KB 分块阈值的长输入可逆（bytesToBinary 多块分支）', () => {
    const long = 'a'.repeat(100_000)
    expect(decodeBase64(encodeBase64(long))).toEqual({ text: long, isText: true })
    // 多字节文本的字节数（3 * 20000 = 60000）同样跨过 CHUNK
    const multi = '汉'.repeat(20_000)
    expect(decodeBase64(encodeBase64(multi))).toEqual({ text: multi, isText: true })
  })
})

describe('isLikelyBase64', () => {
  it('空串与纯空白判为否', () => {
    expect(isLikelyBase64('')).toBe(false)
    expect(isLikelyBase64('   ')).toBe(false)
    expect(isLikelyBase64('\n\t')).toBe(false)
  })

  it('长度模 4 余 1（无法补位）判为否', () => {
    for (const bad of ['a', 'abcde', 'abcdefghi']) {
      expect(isLikelyBase64(bad), bad).toBe(false)
    }
  })

  it('长度模 4 为 0/2/3 且字符合法判为是（标准与 URL-safe 都接受）', () => {
    for (const good of ['YQ==', 'YWI=', 'YWJj', 'ab', 'abc', 'Pz8/', 'Pz8_', 'a_b-', '//++']) {
      expect(isLikelyBase64(good), good).toBe(true)
    }
  })

  it('先剥离空白与换行再判断', () => {
    expect(isLikelyBase64('aGVs\nbG8=')).toBe(true)
    expect(isLikelyBase64(' Y Q = = ')).toBe(true)
    expect(isLikelyBase64('YQ==\n')).toBe(true)
  })

  it('非法字符、超量 padding、非 ASCII 判为否', () => {
    for (const bad of ['ab*d', 'YQ===', 'Y=Q=', '你好', 'a😀b', 'YQ==3']) {
      expect(isLikelyBase64(bad), bad).toBe(false)
    }
  })

  it('只有 padding 的 "==" 通过启发式（长度合法但 decode 仍会抛错）', () => {
    // 记录启发式与真实解码的差异：isLikelyBase64 只做字符集 + 长度粗筛
    expect(isLikelyBase64('==')).toBe(true)
    expect(() => decodeBase64('==')).toThrow('不是有效的 Base64：字符集或长度不正确')
  })

  it('单个 "=" 因长度为 1（模 4 余 1）判为否', () => {
    expect(isLikelyBase64('=')).toBe(false)
  })
})
