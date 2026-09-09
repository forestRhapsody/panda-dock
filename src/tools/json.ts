import { parse, printParseErrorCode } from 'jsonc-parser'
import type { ParseError } from 'jsonc-parser'

import i18n from '@/i18n'

export interface JsonResult {
  ok: boolean
  text?: string
  error?: string
  line?: number
  column?: number
  offset?: number
}

export type JsonIndent = 2 | 4 | 'tab'

export interface JsonProcessOptions {
  indent?: JsonIndent | number | string
  sortKeys?: boolean
  autoUnescape?: boolean
}

/** 规范化处理选项，兼容旧式单独传入 indent 参数 */
function normalizeOptions(opts?: JsonProcessOptions | JsonIndent | number | string): {
  indent: JsonIndent | number | string
  sortKeys: boolean
  autoUnescape: boolean
} {
  if (opts === undefined || opts === null) {
    return { indent: 2, sortKeys: false, autoUnescape: false }
  }
  if (typeof opts === 'number' || opts === 'tab' || typeof opts === 'string') {
    return { indent: opts, sortKeys: false, autoUnescape: false }
  }
  return {
    indent: opts.indent ?? 2,
    sortKeys: Boolean(opts.sortKeys),
    autoUnescape: Boolean(opts.autoUnescape),
  }
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

/** 计算字符 offset 对应的行号与列号（均从 1 开始） */
function getLineAndCol(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length))
  const lines = text.slice(0, safeOffset).split('\n')
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  }
}

/** 规范缩进参数 */
function getIndentParam(indent: JsonIndent | number | string): string | number {
  if (indent === 'tab' || indent === '\t') return '\t'
  const num = Number(indent)
  return Number.isFinite(num) && num > 0 ? num : 2
}

/**
 * 尝试去转义文本：支持带首尾双引号的 JSON 字符串字面量与无包裹引号的反斜杠转义
 */
export function tryUnescape(raw: string): { ok: boolean; text: string } {
  const text = raw.trim()
  if (!text) return { ok: false, text }

  // 1. 标准带首尾双引号的 JSON 字符串字面量（例如 "\"{\\\"name\\\":\\\"toolkit\\\"}\""）
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      const unquoted = JSON.parse(text)
      if (typeof unquoted === 'string') {
        return { ok: true, text: unquoted }
      }
    } catch {
      // 容错继续尝试正则替换
    }
  }

  // 2. 正则处理反斜杠转义（如日志中的 {\"name\":\"toolkit\"}）
  const unescaped = text
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\//g, '/')

  // 若首尾剥离后仍有多余的包裹引号且内部为合法 JSON
  if (
    (unescaped.startsWith('"') && unescaped.endsWith('"')) ||
    (unescaped.startsWith("'") && unescaped.endsWith("'"))
  ) {
    const trimmedQuotes = unescaped.slice(1, -1).trim()
    const parsedTrimmed = parse(trimmedQuotes, [], { allowTrailingComma: true })
    if (parsedTrimmed !== undefined) {
      return { ok: true, text: trimmedQuotes }
    }
  }

  if (unescaped !== text) {
    return { ok: true, text: unescaped }
  }

  return { ok: false, text }
}

/** 预处理输入文本：若开启 autoUnescape 则自动先去转义 */
function prepareInput(raw: string, autoUnescape = false): string {
  const text = raw.trim()
  if (!autoUnescape || !text) return text
  const unesc = tryUnescape(text)
  return unesc.ok ? unesc.text : text
}

/** 解析 JSON/JSONC：允许注释与尾随逗号；错误时精准计算行列 */
export function parseJsonc(
  raw: string,
):
  | { ok: true; value: unknown }
  | { ok: false; error: string; line: number; column: number; offset: number } {
  const errors: ParseError[] = []
  const value = parse(raw, errors, { allowTrailingComma: true })

  // JSON 允许 null（解析为 null），空内容解析为 undefined
  if (value === undefined && errors.length === 0) {
    return { ok: false, error: i18n.t('tool.json.errorEmpty'), line: 1, column: 1, offset: 0 }
  }
  if (errors.length > 0) {
    const err = errors[0]
    const code = printParseErrorCode(err.error)
    const { line, column } = getLineAndCol(raw, err.offset)
    const detail = i18n.t(ERR_KEYS[code] ?? 'tool.json.errGeneric')
    return {
      ok: false,
      error: i18n.t('tool.json.parseFailedWithPos', { line, column, detail }),
      line,
      column,
      offset: err.offset,
    }
  }
  return { ok: true, value }
}

/** 递归按字典序排序所有 Object 键名（保持 Array 元素顺序不变） */
export function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys)
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sortedKeys = Object.keys(record).sort((a, b) => a.localeCompare(b))
    const sortedObj: Record<string, unknown> = {}
    for (const key of sortedKeys) {
      sortedObj[key] = sortObjectKeys(record[key])
    }
    return sortedObj
  }
  return value
}

/** JSON 格式化（支持自定义缩进 2/4/Tab、键名排序与自动去转义），兼容注释/尾随逗号 */
export function formatJson(
  raw: string,
  options?: JsonProcessOptions | JsonIndent | number | string,
): JsonResult {
  const opt = normalizeOptions(options)
  const text = prepareInput(raw, opt.autoUnescape)
  const res = parseJsonc(text)
  if (!res.ok) return res
  const val = opt.sortKeys ? sortObjectKeys(res.value) : res.value
  return { ok: true, text: JSON.stringify(val, null, getIndentParam(opt.indent)) }
}

/** JSON 压缩为紧凑单行（支持键名排序与自动去转义） */
export function minifyJson(
  raw: string,
  options?: JsonProcessOptions | JsonIndent | number | string,
): JsonResult {
  const opt = normalizeOptions(options)
  const text = prepareInput(raw, opt.autoUnescape)
  const res = parseJsonc(text)
  if (!res.ok) return res
  const val = opt.sortKeys ? sortObjectKeys(res.value) : res.value
  return { ok: true, text: JSON.stringify(val) }
}

/** JSON 对象键名递归排序并格式化输出（兼容旧接口） */
export function sortJsonKeys(
  raw: string,
  options?: JsonProcessOptions | JsonIndent | number | string,
): JsonResult {
  const opt = normalizeOptions(options)
  return formatJson(raw, { ...opt, sortKeys: true })
}

/**
 * 将 JSON 对象或文本转义为单行 JSON 字符串（内层引号与特殊字符转义并添加外部包裹引号，支持键名排序）
 */
export function escapeJson(
  raw: string,
  options?: JsonProcessOptions | JsonIndent | number | string,
): JsonResult {
  const opt = normalizeOptions(options)
  const text = raw.trim()
  if (!text) {
    return { ok: false, error: i18n.t('tool.json.errorEmpty') }
  }
  const parsed = parseJsonc(text)
  if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null) {
    const val = opt.sortKeys ? sortObjectKeys(parsed.value) : parsed.value
    return { ok: true, text: JSON.stringify(JSON.stringify(val)) }
  }
  return { ok: true, text: JSON.stringify(text) }
}

/**
 * 智能去转义：支持带外层引号/无外层引号的转义字符串，还原并优先格式化为标准 JSON（支持同时键名排序与缩进设定）
 */
export function unescapeJson(
  raw: string,
  options?: JsonProcessOptions | JsonIndent | number | string,
): JsonResult {
  const opt = normalizeOptions(options)
  const text = raw.trim()
  if (!text) {
    return { ok: false, error: i18n.t('tool.json.errorEmpty') }
  }

  const unesc = tryUnescape(text)
  const unescapedText = unesc.ok ? unesc.text : text

  // 检验去转义后是否为合法 JSON，若是则应用键排序与缩进
  const parsed = parseJsonc(unescapedText)
  if (parsed.ok) {
    const val = opt.sortKeys ? sortObjectKeys(parsed.value) : parsed.value
    return { ok: true, text: JSON.stringify(val, null, getIndentParam(opt.indent)) }
  }

  // 若去转义操作确实修改了文本（剥离了转义符），返回纯文本
  if (unesc.ok) {
    return { ok: true, text: unescapedText }
  }

  // 原文没有转义符，若本身就是合法 JSON 则同样格式化与排序
  const directParse = parseJsonc(text)
  if (directParse.ok) {
    const val = opt.sortKeys ? sortObjectKeys(directParse.value) : directParse.value
    return { ok: true, text: JSON.stringify(val, null, getIndentParam(opt.indent)) }
  }

  return { ok: false, error: i18n.t('tool.json.unescapeNoChange') }
}

/** 一段标准示例 JSON（包含嵌套对象、数组、布尔与数字，便于一键体验各功能） */
export const SAMPLE_JSON = JSON.stringify(
  {
    name: 'toolkit-extension',
    version: '1.2.0',
    description: 'All-in-one developer toolbox',
    repository: {
      type: 'git',
      url: 'https://github.com/forestRhapsody/dev-box',
    },
    features: ['json', 'base64', 'jwt', 'timestamp', 'storage', 'qrcode', 'hash'],
    author: {
      name: 'Developer',
      email: 'dev@example.com',
    },
    settings: {
      theme: 'system',
      shortcuts: true,
      fontScale: 1,
    },
  },
  null,
  2,
)
