import { describe, expect, it } from 'vitest'

import { decodeBase64, encodeBase64, isLikelyBase64 } from './base64'

describe('encodeBase64', () => {
  it('编码 ASCII 文本并按标准补齐 padding', () => {
    expect(encodeBase64('hello')).toBe('aGVsbG8=')
    expect(encodeBase64('')).toBe('')
  })

  it('按 UTF-8 编码多字节字符', () => {
    expect(encodeBase64('你好')).toBe('5L2g5aW9')
  })
})

describe('decodeBase64', () => {
  it('编码 / 解码可逆（含中文、emoji 代理对与换行）', () => {
    const cases = ['a', '你好，世界', 'a😀b', 'line1\nline2', '{"a":1}', ' 前后空格 ']
    for (const text of cases) {
      const res = decodeBase64(encodeBase64(text))
      expect(res.isText).toBe(true)
      expect(res.text).toBe(text)
    }
  })

  it('忽略空白与换行', () => {
    expect(decodeBase64('aGVs\nbG8=').text).toBe('hello')
    expect(decodeBase64(' aGVs bG8= ').text).toBe('hello')
  })

  it('兼容 URL-safe（-/_）与省略 padding 的写法', () => {
    // '???' 的标准 Base64 为 Pz8/（本身无 padding），URL-safe 为 Pz8_
    expect(decodeBase64('Pz8/').text).toBe('???')
    expect(decodeBase64('Pz8_').text).toBe('???')
    // 省略 padding 时按 4 字符一组补位：2 字符补 '=='、3 字符补 '='
    expect(decodeBase64('YQ').text).toBe('a')
    expect(decodeBase64('YWI').text).toBe('ab')
  })

  it('长度模 4 余 1 属非法长度并抛错', () => {
    expect(() => decodeBase64('abcde')).toThrow(/Base64/)
  })

  it('字符集非法时抛错', () => {
    expect(() => decodeBase64('ab*d')).toThrow(/Base64/)
  })

  it('非 UTF-8 字节不抛错：isText=false 且保留原始字节', () => {
    // PNG 魔数 89 50 4E 47：合法 Base64，但不构成合法 UTF-8 文本
    const res = decodeBase64('iVBORw==')
    expect(res.isText).toBe(false)
    expect(res.text.length).toBe(4)
  })
})

describe('isLikelyBase64', () => {
  it('空串与模 4 余 1 的长度判为否', () => {
    expect(isLikelyBase64('')).toBe(false)
    expect(isLikelyBase64('abcde')).toBe(false)
  })

  it('标准短串判为是', () => {
    expect(isLikelyBase64('YQ==')).toBe(true)
  })
})
