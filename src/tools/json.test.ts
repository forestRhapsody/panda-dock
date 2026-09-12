import { describe, expect, it } from 'vitest'

import {
  escapeJson,
  formatJson,
  minifyJson,
  parseJsonc,
  SAMPLE_JSON,
  sortJsonKeys,
  sortObjectKeys,
  tryUnescape,
  unescapeJson,
} from './json'

describe('parseJsonc', () => {
  it('接受注释、尾随逗号与裸 null', () => {
    expect(parseJsonc('{"a":1,}')).toMatchObject({ ok: true, value: { a: 1 } })
    expect(parseJsonc('{"a":1 // 注释\n}')).toMatchObject({ ok: true, value: { a: 1 } })
    expect(parseJsonc('null')).toMatchObject({ ok: true, value: null })
  })

  it('空内容给出错误而非崩溃', () => {
    const res = parseJsonc('')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.length).toBeGreaterThan(0)
  })

  it('语法错误时给出精确的行号、列号与偏移', () => {
    const res = parseJsonc('{\n  "a": 1\n  "b": 2\n}')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.line).toBe(3)
    expect(res.column).toBeGreaterThanOrEqual(1)
    expect(res.offset).toBeGreaterThan(0)
    expect(res.error.length).toBeGreaterThan(0)
  })
})

describe('formatJson / minifyJson', () => {
  it('默认两空格缩进', () => {
    expect(formatJson('{"a":1}').text).toBe('{\n  "a": 1\n}')
  })

  it('支持 4 空格与 Tab 缩进', () => {
    expect(formatJson('{"a":1}', 4).text).toBe('{\n    "a": 1\n}')
    expect(formatJson('{"a":1}', 'tab').text).toBe('{\n\t"a": 1\n}')
  })

  it('键名递归排序（数组顺序保持不变）', () => {
    const res = formatJson('{"b":1,"a":{"d":1,"c":[3,1,2]}}', { sortKeys: true })
    expect(res.text).toBe(`{
  "a": {
    "c": [
      3,
      1,
      2
    ],
    "d": 1
  },
  "b": 1
}`)
  })

  it('压缩为单行', () => {
    expect(minifyJson('{\n  "a": 1,\n  "b": [1, 2]\n}').text).toBe('{"a":1,"b":[1,2]}')
  })

  it('自动去转义开关生效', () => {
    const raw = '{\\"a\\":1}'
    expect(formatJson(raw, { autoUnescape: true }).text).toBe('{\n  "a": 1\n}')
    expect(formatJson(raw).ok).toBe(false)
  })

  it('非法输入返回错误并携带行列信息', () => {
    const res = formatJson('{')
    expect(res.ok).toBe(false)
    expect(res.line).toBeGreaterThanOrEqual(1)
  })

  it('示例 JSON 可格式化与压缩互转', () => {
    expect(parseJsonc(SAMPLE_JSON).ok).toBe(true)
    const minified = minifyJson(SAMPLE_JSON).text
    expect(minified).not.toContain('\n')
    expect(formatJson(minified ?? '').text).toBe(SAMPLE_JSON)
  })

  it('sortJsonKeys 等价于开启 sortKeys 的格式化', () => {
    expect(sortJsonKeys('{"b":1,"a":2}').text).toBe(
      formatJson('{"b":1,"a":2}', { sortKeys: true }).text,
    )
  })
})

describe('sortObjectKeys', () => {
  it('递归排序对象键、保持数组元素顺序、原样返回标量', () => {
    expect(sortObjectKeys({ b: 1, a: { d: 2, c: 3 } })).toEqual({ a: { c: 3, d: 2 }, b: 1 })
    expect(sortObjectKeys([{ b: 1, a: 2 }])).toEqual([{ a: 2, b: 1 }])
    expect(sortObjectKeys('x')).toBe('x')
    expect(sortObjectKeys(null)).toBeNull()
  })
})

describe('escapeJson / unescapeJson / tryUnescape', () => {
  it('对象转义为带外层引号的单行 JSON 字符串', () => {
    expect(escapeJson('{"a":1}').text).toBe(JSON.stringify(JSON.stringify({ a: 1 })))
  })

  it('普通文本按字符串转义', () => {
    expect(escapeJson('plain text').text).toBe(JSON.stringify('plain text'))
  })

  it('空输入报错', () => {
    expect(escapeJson('').ok).toBe(false)
    expect(unescapeJson('').ok).toBe(false)
  })

  it('去转义无外层引号的转义串并格式化为标准 JSON', () => {
    expect(unescapeJson('{\\"a\\":1}').text).toBe('{\n  "a": 1\n}')
  })

  it('去转义带外层引号的 JSON 字符串字面量', () => {
    expect(unescapeJson('"{\\"a\\":1}"').text).toBe('{\n  "a": 1\n}')
  })

  it('去转义时可同时应用键名排序', () => {
    expect(unescapeJson('{\\"b\\":1,\\"a\\":2}', { sortKeys: true }).text).toBe(
      '{\n  "a": 2,\n  "b": 1\n}',
    )
  })

  it('无任何转义且不是合法 JSON 时报错', () => {
    expect(unescapeJson('plain').ok).toBe(false)
  })

  it('tryUnescape 对无转义文本返回 ok:false', () => {
    expect(tryUnescape('plain').ok).toBe(false)
    expect(tryUnescape('').ok).toBe(false)
    expect(tryUnescape('{\\"a\\":1}')).toEqual({ ok: true, text: '{"a":1}' })
  })
})
