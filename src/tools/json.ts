import { parse, printParseErrorCode } from 'jsonc-parser'
import type { ParseError } from 'jsonc-parser'

export interface JsonResult {
  ok: boolean
  text?: string
  error?: string
}

/** jsonc-parser 错误码(字符串) → 中文友好提示 */
const ERR_MESSAGES: Record<string, string> = {
  InvalidSymbol: '包含非法字符',
  InvalidNumberFormat: '数字格式非法',
  PropertyNameExpected: '缺少属性名',
  ValueExpected: '缺少值',
  ColonExpected: '缺少冒号 ":"',
  CommaExpected: '缺少逗号 ","',
  CloseBraceExpected: '缺少右花括号 "}"',
  CloseBracketExpected: '缺少右方括号 "]"',
  EndOfFileExpected: 'JSON 已结束但仍有额外内容',
  InvalidCommentToken: '注释格式非法',
  UnexpectedEndOfComment: '注释未闭合',
  UnexpectedEndOfString: '字符串未闭合',
  UnexpectedEndOfNumber: '数字未结束',
  InvalidUnicode: 'Unicode 转义非法',
  InvalidEscapeCharacter: '转义字符非法',
  InvalidCharacter: '包含非法字符',
}

/** 解析 JSON/JSONC：允许注释（// 行注释与块注释）与尾随逗号；错误时给出友好提示 */
function parseJsonc(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const errors: ParseError[] = []
  const value = parse(raw, errors, { allowTrailingComma: true })

  // JSON 允许 null（解析为 null），空内容解析为 undefined
  if (value === undefined && errors.length === 0) {
    return { ok: false, error: '请输入 JSON 内容' }
  }
  if (errors.length > 0) {
    const code = printParseErrorCode(errors[0].error)
    const detail = ERR_MESSAGES[code] ?? '格式错误'
    return { ok: false, error: `JSON 解析失败：${detail}` }
  }
  return { ok: true, value }
}

/** JSON 格式化（默认 2 空格缩进），支持注释/尾随逗号 */
export function formatJson(raw: string, indent = 2): JsonResult {
  const res = parseJsonc(raw)
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, text: JSON.stringify(res.value, null, indent) }
}

/** JSON 压缩为单行，支持注释/尾随逗号 */
export function minifyJson(raw: string): JsonResult {
  const res = parseJsonc(raw)
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, text: JSON.stringify(res.value) }
}
