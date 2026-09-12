import qs from 'qs'

export interface UrlPart {
  key: string
  value: string
}

export interface ParsedUrl {
  url: URL
  parts: UrlPart[]
  /** 查询参数：qs 解析出结构化对象后扁平化为 kv 列表（嵌套/数组用括号记法） */
  params: UrlPart[]
}

export type CodecAction = 'decode' | 'encode'
export type CodecScope = 'component' | 'full'

/** 认可的网络协议白名单（仅 http/https 等，非法 scheme 如 httpas:// 一律判无效） */
export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'ws:', 'wss:', 'file:'])

/** 当前页 origin，用作相对路径的解析基准 */
function currentBase(): string {
  return (typeof window !== 'undefined' && window.location.href) || 'http://localhost/'
}

/** 从文本中抽取已认可协议的网址（去除前后的干扰文字与尾部标点） */
export function extractUrlFromText(text: string): string | null {
  const m = text.match(
    /(?:https?|ftp|ws|wss|file):\/\/[^\s<>"'`\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/i,
  )
  if (!m) return null
  return m[0].replace(/[.,;:!?'")\]}\u3000-\u303f\uff00-\uffef]+$/, '')
}

/** 把候选字符串解析为 URL：绝对 → localhost / IP / 无协议域名(补 https/http) → 相对路径(按当前页 origin)；校验协议合法性 */
export function buildUrl(source: string, base: string = currentBase()): URL {
  const candidates: (() => URL)[] = [
    () => new URL(source),
    // localhost（含可选端口与路径）：补 http
    () => {
      if (/^localhost(?::\d+)?([/?#].*)?$/i.test(source)) {
        return new URL(`http://${source}`)
      }
      throw new Error('invalid')
    },
    // IPv4 地址（含可选端口与路径）：补 http
    () => {
      if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?([/?#].*)?$/.test(source)) {
        return new URL(`http://${source}`)
      }
      throw new Error('invalid')
    },
    // 无协议但像完整域名（含可选端口与路径）：补 https
    () => {
      if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?([/?#].*)?$/i.test(source)) {
        return new URL(`https://${source}`)
      }
      throw new Error('invalid')
    },
    // 相对路径（以 / ./ ../ 开头）：按当前页 origin 解析
    () => {
      if (/^[./]/.test(source)) return new URL(source, base)
      throw new Error('invalid')
    },
  ]
  for (const make of candidates) {
    try {
      const url = make()
      if (ALLOWED_PROTOCOLS.has(url.protocol)) return url
    } catch {
      // 继续尝试下一种
    }
  }
  throw new Error('invalid')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把 qs 解析出的结构化对象扁平化为 kv 列表（对象/数组用括号记法，如 filter[name]、ids[0]） */
export function flattenParams(query: Record<string, unknown>): UrlPart[] {
  const out: UrlPart[] = []
  const walk = (value: unknown, prefix: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isPlainObject(item) || Array.isArray(item)) walk(item, `${prefix}[${index}]`)
        else out.push({ key: `${prefix}[${index}]`, value: String(item) })
      })
      return
    }
    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        const key = prefix ? `${prefix}[${k}]` : k
        if (isPlainObject(v) || Array.isArray(v)) walk(v, key)
        else out.push({ key, value: String(v) })
      }
      return
    }
    out.push({ key: prefix, value: String(value) })
  }
  walk(query, '')
  return out
}

/** 只保留「有实际值」的组成部分，避免展示无用空列 */
function collectParts(url: URL): UrlPart[] {
  const parts: UrlPart[] = []
  if (url.protocol) parts.push({ key: 'protocol', value: url.protocol })
  if (url.origin && url.origin !== 'null') parts.push({ key: 'origin', value: url.origin })
  if (url.host) parts.push({ key: 'host', value: url.host })
  if (url.port) parts.push({ key: 'port', value: url.port })
  if (url.pathname && url.pathname !== '/') parts.push({ key: 'path', value: url.pathname })
  if (url.search) parts.push({ key: 'search', value: url.search })
  if (url.hash) parts.push({ key: 'hash', value: url.hash })
  if (url.username) parts.push({ key: 'username', value: url.username })
  if (url.password) parts.push({ key: 'password', value: url.password })
  return parts
}

/** 解析 URL：先从文本抽取网址，再交给 buildUrl（校验协议）；查询参数用 qs 解析后扁平化 */
export function parseUrl(input: string, base?: string): ParsedUrl {
  const text = input.trim()
  const extracted = extractUrlFromText(text) ?? text
  const url = buildUrl(extracted, base)
  const parts = collectParts(url)
  const query = qs.parse(url.search.replace(/^\?/, '')) as Record<string, unknown>
  const params = flattenParams(query)
  return { url, parts, params }
}

/**
 * URL 编码：
 * - component: 使用 encodeURIComponent，编码全部特殊字符（包括 &/?/=# 等），适合参数
 * - full: 使用 encodeURI，保留网络协议与路径分隔符，适合整串 URL
 * 捕获畸形字符（如孤立代理对 lone surrogate）错误并保证返回安全对象
 */
export function encodeUrl(
  text: string,
  scope: CodecScope,
): { ok: true; text: string } | { ok: false; error: string } {
  if (!text) return { ok: true, text: '' }
  try {
    const res = scope === 'full' ? encodeURI(text) : encodeURIComponent(text)
    return { ok: true, text: res }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Encode failed',
    }
  }
}

/**
 * URL 解码：
 * - component: 使用 decodeURIComponent
 * - full: 使用 decodeURI
 * 捕获畸形 % 编码序列错误并标记 isMalformed
 */
export function decodeUrl(
  text: string,
  scope: CodecScope,
): { ok: true; text: string } | { ok: false; error: string; isMalformed?: boolean } {
  if (!text) return { ok: true, text: '' }
  try {
    const res = scope === 'full' ? decodeURI(text) : decodeURIComponent(text)
    return { ok: true, text: res }
  } catch (e) {
    const isMalformed = e instanceof URIError || String(e).includes('malformed')
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Decode failed',
      isMalformed,
    }
  }
}
