import { parse, printParseErrorCode } from 'jsonc-parser'
import type { ParseError } from 'jsonc-parser'

import i18n from '@/i18n'

export interface JsonResult {
  ok: boolean
  text?: string
  error?: string
}

/** jsonc-parser 错误码(字符串) → 错误提示 i18n key */
const ERR_KEYS: Record<string, string> = {
  InvalidSymbol: 'tool.json.errInvalidSymbol',
  InvalidNumberFormat: 'tool.json.errInvalidNumberFormat',
  PropertyNameExpected: 'tool.json.errPropertyNameExpected',
  ValueExpected: 'tool.json.errValueExpected',
  ColonExpected: 'tool.json.errColonExpected',
  CommaExpected: 'tool.json.errCommaExpected',
  CloseBraceExpected: 'tool.json.errCloseBraceExpected',
  CloseBracketExpected: 'tool.json.errCloseBracketExpected',
  EndOfFileExpected: 'tool.json.errEndOfFileExpected',
  InvalidCommentToken: 'tool.json.errInvalidCommentToken',
  UnexpectedEndOfComment: 'tool.json.errUnexpectedEndOfComment',
  UnexpectedEndOfString: 'tool.json.errUnexpectedEndOfString',
  UnexpectedEndOfNumber: 'tool.json.errUnexpectedEndOfNumber',
  InvalidUnicode: 'tool.json.errInvalidUnicode',
  InvalidEscapeCharacter: 'tool.json.errInvalidEscapeCharacter',
  InvalidCharacter: 'tool.json.errInvalidCharacter',
}

/** 解析 JSON/JSONC：允许注释（// 行注释与块注释）与尾随逗号；错误时给出友好提示 */
function parseJsonc(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const errors: ParseError[] = []
  const value = parse(raw, errors, { allowTrailingComma: true })

  // JSON 允许 null（解析为 null），空内容解析为 undefined
  if (value === undefined && errors.length === 0) {
    return { ok: false, error: i18n.t('tool.json.errorEmpty') }
  }
  if (errors.length > 0) {
    const code = printParseErrorCode(errors[0].error)
    const detail = i18n.t(ERR_KEYS[code] ?? 'tool.json.errGeneric')
    return { ok: false, error: i18n.t('tool.json.parseFailed', { detail }) }
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
