import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import i18n from '@/i18n'

import zh from '../i18n/locales/zh.json'
import {
  escapeJson,
  formatAndMinifyJson,
  formatJson,
  isJsonText,
  minifyJson,
  parseJsonc,
  sortJsonKeys,
  sortObjectKeys,
  tryUnescape,
  unescapeJson,
} from './json'

/** 用户点「填入示例」实际拿到的就是语言包里这份（见 tool.json.sample） */
const SAMPLE_JSON = zh.tool.json.sample

/**
 * json.ts 是纯逻辑模块，但错误文案走 i18n，因此本文件同时覆盖：
 * - 每个导出函数的正常路径、边界值（空/空白、标量、深层嵌套、大数字、Unicode）与降级分支；
 * - JSONC 兼容性（注释、尾随逗号、CRLF/BOM）与 jsonc-parser 的错误码 → 文案映射；
 * - 旧接口形态（indent 作为第二个参数）与非布尔选项的强制转换；
 * - 文案的中英双语（切 en 不含中文、切 zh 含中文），afterAll 恢复 zh。
 */

/** 断言解析成功并取出值；失败时抛出可读信息，避免每个用例重复写类型收窄 */
function parseOk(raw: string): unknown {
  const res = parseJsonc(raw)
  if (!res.ok) throw new Error(`期望解析成功，实际失败：${res.error}`)
  return res.value
}

/** 断言解析失败并返回带行列的错误对象 */
function parseErr(raw: string) {
  const res = parseJsonc(raw)
  if (res.ok) throw new Error(`期望解析失败，实际成功：${JSON.stringify(res.value)}`)
  return res
}

/**
 * 各错误码对应的首个错误（输入 → 中文详情 / 行列 / offset）。
 * 行列与 offset 来自 jsonc-parser 的真实报错位置，用来钉住 getLineAndCol 的换算。
 */
const ERROR_CASES = [
  { raw: '{', detail: '缺少右花括号', line: 1, column: 2, offset: 1 },
  { raw: '[1,2', detail: '缺少右方括号', line: 1, column: 5, offset: 4 },
  { raw: '{"a" 1}', detail: '缺少冒号', line: 1, column: 6, offset: 5 },
  { raw: '{"a":1 "b":2}', detail: '缺少逗号', line: 1, column: 8, offset: 7 },
  { raw: '{"a":}', detail: '缺少值', line: 1, column: 6, offset: 5 },
  { raw: '{1:2}', detail: '缺少属性名', line: 1, column: 2, offset: 1 },
  { raw: 'tru', detail: '包含非法字符', line: 1, column: 1, offset: 0 },
  { raw: '"abc', detail: '字符串未闭合', line: 1, column: 1, offset: 0 },
  { raw: '"\\u12"', detail: 'Unicode 转义非法', line: 1, column: 1, offset: 0 },
  { raw: '"\\q"', detail: '转义字符非法', line: 1, column: 1, offset: 0 },
  { raw: '1e', detail: '数字不完整', line: 1, column: 1, offset: 0 },
  { raw: '/* 未闭合', detail: '注释未闭合', line: 1, column: 1, offset: 0 },
  { raw: '1 2', detail: 'JSON 已结束，存在多余内容', line: 1, column: 3, offset: 2 },
]

// 显式锁定中文，避免用例结果依赖 i18n 的默认语言（也避免依赖测试执行顺序）
beforeAll(async () => {
  await i18n.changeLanguage('zh')
})

describe('parseJsonc：JSONC 兼容与错误定位', () => {
  it('接受行注释、块注释与尾随逗号（旧配置数据的常见形态）', () => {
    expect(parseOk('{"a":1,}')).toEqual({ a: 1 })
    expect(parseOk('[1,2,]')).toEqual([1, 2])
    expect(parseOk('{"a":1 // 行注释\n}')).toEqual({ a: 1 })
    expect(parseOk('{\n/* 块注释 */\n"a":1\n}')).toEqual({ a: 1 })
    expect(parseOk('// 注释行在前\n{"a":1}')).toEqual({ a: 1 })
    expect(parseOk('/* 注释 */ {"a":1}')).toEqual({ a: 1 })
    expect(parseOk('  {"a":1}  ')).toEqual({ a: 1 })
    expect(parseOk('{\n  "a": 1,\n}')).toEqual({ a: 1 })
  })

  it('接受全部 JSON 标量（null / true / false / 数字 / 字符串）', () => {
    expect(parseOk('null')).toBeNull()
    expect(parseOk('true')).toBe(true)
    expect(parseOk('false')).toBe(false)
    expect(parseOk('0')).toBe(0)
    expect(parseOk('-1.5')).toBe(-1.5)
    expect(parseOk('""')).toBe('')
    expect(parseOk('"x"')).toBe('x')
  })

  it('重复键以最后一个为准（JSON.parse 语义）', () => {
    expect(parseOk('{"a":1,"a":2}')).toEqual({ a: 2 })
  })

  it('超过安全整数的数字在解析阶段就丢精度（记录当前行为，不做 BigInt 保留）', () => {
    expect(parseOk('9007199254740993')).toBe(9007199254740992)
    expect(parseOk('12345678901234567890')).toBe(12345678901234567000)
  })

  it('__proto__ 键被 jsonc-parser 丢弃：不污染原型，但也丢失该字段', () => {
    const value = parseOk('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>
    expect(value).toEqual({ a: 1 })
    expect(Object.keys(value)).toEqual(['a'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('Unicode 转义与 emoji 代理对按字面值还原', () => {
    expect(parseOk('"\\u4f60\\u597d"')).toBe('你好')
    expect(parseOk('"\\uD83D\\uDE00"')).toBe('😀')
    expect(parseOk('"😀"')).toBe('😀')
  })

  it('空串 / 纯空白 / 只有注释都判为失败而不是崩溃', () => {
    for (const raw of ['', '   ', '\n\t ', '// 只有注释', '/* 只有注释 */']) {
      expect(parseJsonc(raw).ok, JSON.stringify(raw)).toBe(false)
    }
  })

  it('空内容走的是通用解析错误（带行列），而不是专属的 errorEmpty 文案', () => {
    // parseJsonc 的 `value === undefined && errors.length === 0` 分支实际不可达：
    // jsonc-parser 对空输入会产出 ValueExpected 错误，因此这里应带位置信息
    const res = parseErr('')
    expect(res.line).toBe(1)
    expect(res.column).toBe(1)
    expect(res.offset).toBe(0)
    expect(res.error).toContain('第 1 行第 1 列')
    expect(res.error).not.toBe(i18n.t('tool.json.errorEmpty'))
  })

  it('各类语法错误映射到不同详情，并给出精确行列与 offset', () => {
    for (const c of ERROR_CASES) {
      const res = parseErr(c.raw)
      expect(res.error, c.raw).toContain(c.detail)
      expect(res.line, c.raw).toBe(c.line)
      expect(res.column, c.raw).toBe(c.column)
      expect(res.offset, c.raw).toBe(c.offset)
    }
  })

  it('offset 指回原始文本中的出错字符', () => {
    const raw = '{\n  "a": 1\n  "b": 2\n}'
    const res = parseErr(raw)
    expect(res.line).toBe(3)
    expect(res.column).toBe(3)
    expect(res.offset).toBe(13)
    expect(raw[res.offset]).toBe('"')
  })

  it('CRLF 换行也能算出行号（不会把 \\r 计入列号）', () => {
    const res = parseErr('{\r\n  "a": 1\r\n  "b": 2\r\n}')
    expect(res.line).toBe(3)
    expect(res.column).toBe(3)
  })

  it('带 BOM 的输入在 parseJsonc 下会报错，但 formatJson 会先 trim 掉 BOM', () => {
    // U+FEFF 是 JS 的空白字符：parseJsonc 不 trim 所以命中 InvalidSymbol，formatJson 会先 trim
    expect(parseJsonc('\uFEFF{"a":1}').ok).toBe(false)
    expect(formatJson('\uFEFF{"a":1}').text).toBe('{\n  "a": 1\n}')
  })

  it('深层嵌套（200 层）可正常解析', () => {
    const deep = '['.repeat(200) + '1' + ']'.repeat(200)
    expect(parseJsonc(deep).ok).toBe(true)
    let node: unknown = parseOk(deep)
    for (let i = 0; i < 200; i++) {
      expect(Array.isArray(node), `第 ${i} 层应为数组`).toBe(true)
      node = (node as unknown[])[0]
    }
    expect(node).toBe(1)
  })
})

describe('sortObjectKeys', () => {
  it('递归排序对象键（localeCompare 而非码位排序）', () => {
    expect(sortObjectKeys({ b: 1, a: { d: 2, c: 3 } })).toEqual({ a: { c: 3, d: 2 }, b: 1 })
    expect(Object.keys(sortObjectKeys({ b: 1, a: 2, c: 3 }) as object)).toEqual(['a', 'b', 'c'])
    // 码位排序会把大写 'B' 排在 'a' 前；localeCompare 则把 'a' 排在 'B' 前
    expect(Object.keys(sortObjectKeys({ B: 1, a: 2 }) as object)).toEqual(['a', 'B'])
  })

  it('数组只递归元素、保持元素顺序不变', () => {
    expect(sortObjectKeys([{ b: 1, a: 2 }, 3, 'x'])).toEqual([{ a: 2, b: 1 }, 3, 'x'])
    expect(sortObjectKeys([3, 1, 2])).toEqual([3, 1, 2])
  })

  it('标量与 null / undefined / NaN 原样返回', () => {
    for (const v of ['x', 0, -1, true, false, null, undefined, NaN]) {
      expect(sortObjectKeys(v)).toBe(v)
    }
  })

  it('类型混杂的对象：排序后各值类型与内容不变', () => {
    const out = sortObjectKeys({
      n: 1,
      s: 'x',
      b: true,
      nil: null,
      arr: [1, { z: 1, a: 2 }],
      obj: { y: 1, x: 2 },
    })
    expect(out).toEqual({
      arr: [1, { a: 2, z: 1 }],
      b: true,
      n: 1,
      nil: null,
      obj: { x: 2, y: 1 },
      s: 'x',
    })
  })

  it('直接传入含 __proto__ 自身键的对象时该键会被丢弃（不污染原型）', () => {
    // JSON.parse 会创建 __proto__ 自身属性；sortObjectKeys 用普通对象重新赋值，数字会被静默忽略
    const input = JSON.parse('{"__proto__":1,"a":2}') as Record<string, unknown>
    const out = sortObjectKeys(input) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['a'])
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('循环引用没有环检测：会以栈溢出结束（调用方须先经 JSON 解析保证无环）', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(() => sortObjectKeys(cyclic)).toThrow(RangeError)
  })
})

describe('formatJson：缩进与选项归一化', () => {
  it('默认 2 空格；4 / 3 空格与 Tab 都可指定', () => {
    expect(formatJson('{"a":1}').text).toBe('{\n  "a": 1\n}')
    expect(formatJson('{"a":1}', 4).text).toBe('{\n    "a": 1\n}')
    expect(formatJson('{"a":1}', 3).text).toBe('{\n   "a": 1\n}')
    expect(formatJson('{"a":1}', 'tab').text).toBe('{\n\t"a": 1\n}')
  })

  it('兼容旧接口：indent 直接作为第二个参数（含 "\\t" 与数字字符串）', () => {
    expect(formatJson('{"a":1}', '\t').text).toBe('{\n\t"a": 1\n}')
    expect(formatJson('{"a":1}', '4').text).toBe('{\n    "a": 1\n}')
    expect(formatJson('{"a":1}', 2).text).toBe('{\n  "a": 1\n}')
  })

  it('非法缩进回退到 2 空格（0 / 负数 / 非数字串 / Infinity / NaN）', () => {
    for (const indent of [0, -2, 'abc', '', Infinity, -Infinity, NaN]) {
      expect(formatJson('{"a":1}', indent).text, String(indent)).toBe('{\n  "a": 1\n}')
    }
  })

  it('对象选项：缺省 indent 为 2，null 选项按默认处理', () => {
    expect(formatJson('{"a":1}', {}).text).toBe('{\n  "a": 1\n}')
    expect(formatJson('{"a":1}', { indent: 4 }).text).toBe('{\n    "a": 1\n}')
    expect(formatJson('{"a":1}', { indent: 'tab' }).text).toBe('{\n\t"a": 1\n}')
    expect(formatJson('{"a":1}', null as unknown as undefined).text).toBe('{\n  "a": 1\n}')
  })

  it('sortKeys / autoUnescape 走布尔强制转换（兼容 0/1 等旧调用）', () => {
    const raw = '{\\"b\\":1,\\"a\\":2}'
    expect(
      formatJson(raw, {
        autoUnescape: 1 as unknown as boolean,
        sortKeys: 0 as unknown as boolean,
      }).text,
    ).toBe('{\n  "b": 1,\n  "a": 2\n}')
    expect(formatJson(raw, { autoUnescape: true, sortKeys: true }).text).toBe(
      '{\n  "a": 2,\n  "b": 1\n}',
    )
  })
})

describe('formatJson / minifyJson', () => {
  it('格式化时容忍注释与尾随逗号', () => {
    expect(formatJson('{\n  // 注释\n  "a": 1,\n}').text).toBe('{\n  "a": 1\n}')
    expect(formatJson('[1, 2, /* x */]').text).toBe('[\n  1,\n  2\n]')
  })

  it('顶层标量也能格式化', () => {
    expect(formatJson('null').text).toBe('null')
    expect(formatJson('123').text).toBe('123')
    expect(formatJson('true').text).toBe('true')
    expect(formatJson('"x"').text).toBe('"x"')
  })

  it('字符串转义在格式化后保持语义（可与原值往返）', () => {
    const res = formatJson('{"a":"line\\nbreak\\t\\"q\\""}')
    expect(res.text).toBe('{\n  "a": "line\\nbreak\\t\\"q\\""\n}')
    expect(parseOk(res.text ?? '')).toEqual({ a: 'line\nbreak\t"q"' })
  })

  it('Unicode 转义在输出中被还原为字面字符', () => {
    expect(formatJson('"\\u4f60"').text).toBe('"你"')
    expect(formatJson('{"\\u0061":1}').text).toBe('{\n  "a": 1\n}')
  })

  it('数字会按 JS 数值语义归一化（1.0 → 1、-0 → 0、1e3 → 1000）', () => {
    expect(minifyJson('[-0, 1.0, 1e3, 0.5]').text).toBe('[0,1,1000,0.5]')
    expect(formatJson('1.0').text).toBe('1')
  })

  it('键名递归排序且数组元素顺序保持', () => {
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

  it('压缩为单行并去掉全部多余空白', () => {
    expect(minifyJson('{\n  "a": 1,\n  "b": [1, 2]\n}').text).toBe('{"a":1,"b":[1,2]}')
    expect(minifyJson('[ 1, 2, 3 ]').text).toBe('[1,2,3]')
    expect(minifyJson('"a b"').text).toBe('"a b"')
    expect(minifyJson('{ /* c */ "a": 1 }').text).toBe('{"a":1}')
  })

  it('压缩时空格缩进参数被忽略（结果始终单行）', () => {
    expect(minifyJson('{"a":1}', 4).text).toBe('{"a":1}')
    expect(minifyJson('{"a":1}', 'tab').text).toBe('{"a":1}')
  })

  it('压缩支持键名排序与自动去转义组合', () => {
    expect(minifyJson('{\\"b\\":1,\\"a\\":2}', { autoUnescape: true, sortKeys: true }).text).toBe(
      '{"a":2,"b":1}',
    )
  })

  it('自动去转义开关：开启可解析，关闭时报错', () => {
    const raw = '{\\"a\\":1}'
    expect(formatJson(raw, { autoUnescape: true }).text).toBe('{\n  "a": 1\n}')
    expect(formatJson(raw).ok).toBe(false)
    expect(minifyJson(raw, { autoUnescape: true }).text).toBe('{"a":1}')
    expect(minifyJson(raw).ok).toBe(false)
  })

  it('非法输入返回错误对象（含行列与 offset），而不是抛异常', () => {
    const res = formatJson('{')
    expect(res.ok).toBe(false)
    expect(res.line).toBe(1)
    expect(res.column).toBe(2)
    expect(res.offset).toBe(1)
    expect(res.text).toBeUndefined()
  })

  it('纯空白输入报解析错误，且 formatJson 的 trim 让位置回到第 1 列', () => {
    const res = formatJson('   ')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('第 1 行第 1 列')
    // 对照：parseJsonc 不 trim，同一输入的位置是第 4 列
    expect(parseErr('   ').column).toBe(4)
  })

  it('格式化幂等：对已格式化文本再格式化结果不变', () => {
    expect(formatJson(SAMPLE_JSON).text).toBe(SAMPLE_JSON)
    expect(formatJson(formatJson(SAMPLE_JSON).text ?? '').text).toBe(SAMPLE_JSON)
  })

  it('format 与 minify 互逆（minify(format(x)) === minify(x)）', () => {
    expect(minifyJson(formatJson(SAMPLE_JSON).text ?? '').text).toBe(minifyJson(SAMPLE_JSON).text)
  })

  it('深层嵌套（200 层）格式化后可被压缩回原样', () => {
    const deep = '['.repeat(200) + '1' + ']'.repeat(200)
    const res = formatJson(deep)
    expect(res.ok).toBe(true)
    expect(res.text?.startsWith('[')).toBe(true)
    expect(minifyJson(res.text ?? '').text).toBe(deep)
  })
})

describe('sortJsonKeys', () => {
  it('等价于开启 sortKeys 的格式化（默认缩进 2）', () => {
    expect(sortJsonKeys('{"b":1,"a":2}').text).toBe(
      formatJson('{"b":1,"a":2}', { sortKeys: true }).text,
    )
  })

  it('即使显式传 sortKeys:false 也会强制排序（旧接口语义）', () => {
    expect(sortJsonKeys('{"b":1,"a":2}', { sortKeys: false }).text).toBe(
      '{\n  "a": 2,\n  "b": 1\n}',
    )
  })

  it('兼容旧接口的 indent 直接传参', () => {
    expect(sortJsonKeys('{"b":1,"a":2}', 4).text).toBe('{\n    "a": 2,\n    "b": 1\n}')
    expect(sortJsonKeys('{"b":1,"a":2}', 'tab').text).toBe('{\n\t"a": 2,\n\t"b": 1\n}')
  })

  it('非法输入同样返回错误对象', () => {
    expect(sortJsonKeys('{').ok).toBe(false)
  })
})

describe('escapeJson', () => {
  it('对象 / 数组转义为带外层引号的单行 JSON 字符串', () => {
    expect(escapeJson('{"a":1}').text).toBe('"{\\"a\\":1}"')
    expect(escapeJson('[1,2]').text).toBe('"[1,2]"')
  })

  it('格式化输入会被压成单行后再转义', () => {
    expect(escapeJson('{\n  "a": 1\n}').text).toBe('"{\\"a\\":1}"')
  })

  it('数字 / 布尔 / null 字面量按普通文本转义为字符串（不保持原类型）', () => {
    expect(escapeJson('123').text).toBe('"123"')
    expect(escapeJson('true').text).toBe('"true"')
    expect(escapeJson('null').text).toBe('"null"')
  })

  it('JSON 字符串字面量会被再次转义（避免双重语义）', () => {
    expect(escapeJson('"x"').text).toBe('"\\"x\\""')
  })

  it('非法 JSON 按纯文本转义，不报错', () => {
    expect(escapeJson('{oops').text).toBe('"{oops"')
    expect(escapeJson('plain text').text).toBe('"plain text"')
    expect(escapeJson('a"b\\c').text).toBe('"a\\"b\\\\c"')
    expect(escapeJson('a"b\\c').text).toBe(JSON.stringify('a"b\\c'))
  })

  it('首尾空白先 trim 再处理', () => {
    expect(escapeJson('  {"a":1}  ').text).toBe('"{\\"a\\":1}"')
  })

  it('sortKeys 对对象生效', () => {
    expect(escapeJson('{"b":1,"a":2}', { sortKeys: true }).text).toBe('"{\\"a\\":2,\\"b\\":1}"')
  })

  it('空串与纯空白返回 errorEmpty', () => {
    for (const raw of ['', '   ', '\n']) {
      const res = escapeJson(raw)
      expect(res.ok, JSON.stringify(raw)).toBe(false)
      expect(res.error).toBe(i18n.t('tool.json.errorEmpty'))
    }
  })

  it('转义结果可被 unescapeJson 还原为格式化 JSON（可逆）', () => {
    const escaped = escapeJson('{"b":[1,2],"a":"x"}', { sortKeys: true }).text ?? ''
    expect(unescapeJson(escaped).text).toBe('{\n  "a": "x",\n  "b": [\n    1,\n    2\n  ]\n}')
  })
})

describe('unescapeJson / tryUnescape', () => {
  it('空串与纯空白返回 errorEmpty', () => {
    for (const raw of ['', '  ', '\t']) {
      expect(unescapeJson(raw).ok, JSON.stringify(raw)).toBe(false)
      expect(unescapeJson(raw).error).toBe(i18n.t('tool.json.errorEmpty'))
    }
  })

  it('无外层引号的转义串 → 格式化 JSON', () => {
    expect(unescapeJson('{\\"a\\":1}').text).toBe('{\n  "a": 1\n}')
  })

  it('带外层双引号的 JSON 字符串字面量 → 格式化 JSON', () => {
    expect(unescapeJson('"{\\"a\\":1}"').text).toBe('{\n  "a": 1\n}')
  })

  it('带外层单引号且内部为合法 JSON → 去引号并格式化', () => {
    expect(unescapeJson('\'{"a":1}\'').text).toBe('{\n  "a": 1\n}')
  })

  it('本来就是合法 JSON（无转义符）也会被格式化', () => {
    expect(unescapeJson('{"b":2,"a":1}').text).toBe('{\n  "b": 2,\n  "a": 1\n}')
  })

  it('去转义确实改变了文本但结果仍非法时，按纯文本降级返回', () => {
    // 去掉 \\" 后得到 { "a" 1 }，仍不是合法 JSON，此时应返回去转义后的纯文本
    const res = unescapeJson('{\\"a\\" 1}')
    expect(res.ok).toBe(true)
    expect(res.text).toBe('{"a" 1}')
    expect(unescapeJson('\\n')).toEqual({ ok: true, text: '\n' })
  })

  it('无转义且不是合法 JSON → unescapeNoChange 错误', () => {
    for (const raw of ['plain', "'not json'", '{oops']) {
      const res = unescapeJson(raw)
      expect(res.ok, raw).toBe(false)
      expect(res.error).toBe(i18n.t('tool.json.unescapeNoChange'))
    }
  })

  it('sortKeys 与 indent 可同时生效', () => {
    expect(unescapeJson('{\\"b\\":1,\\"a\\":2}', { sortKeys: true, indent: 'tab' }).text).toBe(
      '{\n\t"a": 2,\n\t"b": 1\n}',
    )
  })

  it('兼容旧接口：indent 直接传 4', () => {
    expect(unescapeJson('{"a":1}', 4).text).toBe('{\n    "a": 1\n}')
  })

  it('tryUnescape：空串与纯空白返回 ok:false 且文本为 trim 后的空串', () => {
    expect(tryUnescape('')).toEqual({ ok: false, text: '' })
    expect(tryUnescape('   ')).toEqual({ ok: false, text: '' })
  })

  it('tryUnescape：无任何转义的文本原样返回 ok:false（只做 trim）', () => {
    expect(tryUnescape('plain')).toEqual({ ok: false, text: 'plain' })
    expect(tryUnescape('  {"a":1}  ')).toEqual({ ok: false, text: '{"a":1}' })
  })

  it('tryUnescape：带外层双引号的 JSON 字符串字面量按 JSON 语义还原', () => {
    expect(tryUnescape('"{\\"a\\":1}"')).toEqual({ ok: true, text: '{"a":1}' })
    expect(tryUnescape('"line\\nbreak"')).toEqual({ ok: true, text: 'line\nbreak' })
  })

  it('tryUnescape：带外层单引号且内部为合法 JSON 时剥离引号', () => {
    expect(tryUnescape('\'{"a":1}\'')).toEqual({ ok: true, text: '{"a":1}' })
    expect(tryUnescape("'123'")).toEqual({ ok: true, text: '123' })
    expect(tryUnescape("'not json'")).toEqual({ ok: false, text: "'not json'" })
  })

  it('tryUnescape：逐条覆盖反斜杠转义替换', () => {
    expect(tryUnescape('a\\"b')).toEqual({ ok: true, text: 'a"b' })
    expect(tryUnescape("a\\'b")).toEqual({ ok: true, text: "a'b" })
    expect(tryUnescape('a\\\\b')).toEqual({ ok: true, text: 'a\\b' })
    expect(tryUnescape('a\\nb')).toEqual({ ok: true, text: 'a\nb' })
    expect(tryUnescape('a\\rb')).toEqual({ ok: true, text: 'a\rb' })
    expect(tryUnescape('a\\tb')).toEqual({ ok: true, text: 'a\tb' })
    expect(tryUnescape('a\\/b')).toEqual({ ok: true, text: 'a/b' })
  })

  it('tryUnescape：不完整的引号包裹不会被误判为字符串字面量', () => {
    expect(tryUnescape('"abc')).toEqual({ ok: false, text: '"abc' })
    expect(tryUnescape('abc"')).toEqual({ ok: false, text: 'abc"' })
  })

  it('tryUnescape：双引号包裹但含非法 JSON 转义时降级为正则替换', () => {
    // JSON.parse 对 "\q" 抛错；正则也不识别 \q，最终无变化 → ok:false
    expect(tryUnescape('"\\q"')).toEqual({ ok: false, text: '"\\q"' })
  })
})

describe('语言包里的示例 JSON（tool.json.sample）', () => {
  it('是合法 JSON 且包含嵌套对象 / 数组 / 布尔 / 数字（供 UI 一键填充）', () => {
    const value = parseOk(SAMPLE_JSON) as Record<string, unknown>
    expect(typeof value.repository).toBe('object')
    expect(Array.isArray(value.features)).toBe(true)
    const settings = value.settings as Record<string, unknown>
    expect(settings.shortcuts).toBe(true)
    expect(typeof settings.fontScale).toBe('number')
  })

  it('已是 2 空格缩进的标准格式（格式化幂等）', () => {
    expect(formatJson(SAMPLE_JSON).text).toBe(SAMPLE_JSON)
  })

  it('压缩后无换行，且与格式化互逆', () => {
    const minified = minifyJson(SAMPLE_JSON).text ?? ''
    expect(minified).not.toContain('\n')
    expect(formatJson(minified).text).toBe(SAMPLE_JSON)
  })
})

describe('错误文案的 i18n 双语', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

  it('英文界面下语法错误提示为英文且不含中文', async () => {
    await i18n.changeLanguage('en')
    for (const c of ERROR_CASES) {
      const res = parseErr(c.raw)
      expect(res.error, c.raw).toContain('Line 1')
      expect(res.error, c.raw).not.toContain(c.detail)
      expect(CJK.test(res.error), `${c.raw} 的英文文案含中文：${res.error}`).toBe(false)
    }
  })

  it('中文界面下语法错误提示为中文，且包含插值后的行列', async () => {
    await i18n.changeLanguage('zh')
    for (const c of ERROR_CASES) {
      const res = parseErr(c.raw)
      expect(res.error, c.raw).toContain(c.detail)
      expect(res.error, c.raw).toContain(`第 ${c.line} 行第 ${c.column} 列`)
      expect(CJK.test(res.error), c.raw).toBe(true)
    }
  })

  it('不同错误码对应不同文案（未退化为统一的 errGeneric）', async () => {
    await i18n.changeLanguage('zh')
    const errors = ERROR_CASES.map((c) => parseErr(c.raw).error)
    expect(new Set(errors).size).toBe(ERROR_CASES.length)
    expect(errors.some((e) => e.includes(i18n.t('tool.json.errGeneric')))).toBe(false)
  })

  it('errorEmpty 文案中英双语', async () => {
    await i18n.changeLanguage('en')
    const en = escapeJson('  ')
    expect(en.ok).toBe(false)
    expect(en.error).toBe(i18n.t('tool.json.errorEmpty'))
    expect(CJK.test(en.error ?? '')).toBe(false)

    await i18n.changeLanguage('zh')
    const zh = escapeJson('  ')
    expect(zh.error).toBe(i18n.t('tool.json.errorEmpty'))
    expect(CJK.test(zh.error ?? '')).toBe(true)
  })

  it('unescapeNoChange 文案中英双语', async () => {
    await i18n.changeLanguage('en')
    const en = unescapeJson('plain')
    expect(en.error).toBe(i18n.t('tool.json.unescapeNoChange'))
    expect(CJK.test(en.error ?? '')).toBe(false)

    await i18n.changeLanguage('zh')
    const zh = unescapeJson('plain')
    expect(zh.error).toBe(i18n.t('tool.json.unescapeNoChange'))
    expect(CJK.test(zh.error ?? '')).toBe(true)
  })
})

describe('isJsonText：只做布尔校验（智能解析的候选预筛）', () => {
  it('合法 JSON / JSONC 为 true', () => {
    expect(isJsonText('{"a":1}')).toBe(true)
    expect(isJsonText('[1,2]')).toBe(true)
    expect(isJsonText('{ /* c */ "a": 1, }')).toBe(true)
    expect(isJsonText('null')).toBe(true)
  })

  it('非 JSON 与空内容为 false', () => {
    expect(isJsonText('{a: 1}')).toBe(false)
    expect(isJsonText('function f() { return 1 }')).toBe(false)
    expect(isJsonText('')).toBe(false)
    expect(isJsonText('   ')).toBe(false)
  })

  it('极深嵌套不会抛栈溢出，按不可解析处理（回归）', () => {
    const deep = '['.repeat(20000)
    expect(isJsonText(deep)).toBe(false)
    expect(parseJsonc(deep).ok).toBe(false)
    expect(formatJson(deep).ok).toBe(false)
    expect(formatAndMinifyJson(deep)).toBeNull()
  })
})

describe('formatAndMinifyJson：一次解析同时给出两份文本', () => {
  it('格式化按 2 空格缩进、压缩为单行，键序保持原样', () => {
    expect(formatAndMinifyJson('{"b":2,  "a": 1}')).toEqual({
      formatted: '{\n  "b": 2,\n  "a": 1\n}',
      minified: '{"b":2,"a":1}',
    })
  })

  it('非法输入返回 null', () => {
    expect(formatAndMinifyJson('{bad}')).toBeNull()
  })
})
