export interface CookieSetDetails {
  url?: string
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'no_restriction' | 'lax' | 'strict' | 'unspecified'
  expirationDate?: number
  storeId?: string
}

const KNOWN_ATTRS = new Set([
  'domain',
  'path',
  'expires',
  'max-age',
  'secure',
  'httponly',
  'samesite',
  'partitioned',
  'priority',
])

function normalizeSameSite(
  val?: string,
): 'no_restriction' | 'lax' | 'strict' | 'unspecified' | undefined {
  if (!val) return undefined
  const v = val.trim().toLowerCase()
  if (v === 'none' || v === 'no_restriction') return 'no_restriction'
  if (v === 'lax') return 'lax'
  if (v === 'strict') return 'strict'
  return 'unspecified'
}

/**
 * 将单条 Cookie 对象序列化为规范字符串
 */
export function serializeCookieToRaw(
  cookie: Partial<CookieSetDetails>,
  format: 'set-cookie' | 'header' | 'json' = 'set-cookie',
): string {
  if (format === 'json') {
    return JSON.stringify(cookie, null, 2)
  }

  const name = cookie.name?.trim() || ''
  const val = cookie.value || ''
  if (!name && !val) {
    return ''
  }
  if (format === 'header') {
    return `${name}=${val}`
  }

  const parts = [`${name}=${val}`]
  if (cookie.domain) parts.push(`Domain=${cookie.domain}`)
  if (cookie.path) parts.push(`Path=${cookie.path}`)
  if (cookie.expirationDate) {
    parts.push(`Expires=${new Date(cookie.expirationDate * 1000).toUTCString()}`)
  }
  if (cookie.sameSite && cookie.sameSite !== 'unspecified') {
    const s = cookie.sameSite === 'no_restriction' ? 'None' : cookie.sameSite
    parts.push(`SameSite=${s[0].toUpperCase() + s.slice(1)}`)
  }
  if (cookie.secure || cookie.sameSite === 'no_restriction') {
    parts.push('Secure')
  }
  if (cookie.httpOnly) {
    parts.push('HttpOnly')
  }
  return parts.join('; ')
}

/**
 * 解析单行 Set-Cookie 语法
 */
function parseSetCookieLine(
  line: string,
  defaultDomain?: string,
  defaultPath = '/',
): CookieSetDetails | null {
  const parts = line
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  const first = parts[0]
  const eqIdx = first.indexOf('=')
  if (eqIdx <= 0) return null

  const name = first.slice(0, eqIdx).trim()
  const value = first.slice(eqIdx + 1).trim()
  if (!name) return null

  const cookie: CookieSetDetails = {
    name,
    value,
    domain: defaultDomain,
    path: defaultPath,
    secure: false,
    httpOnly: false,
    sameSite: 'lax',
  }

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    const partEq = part.indexOf('=')
    const k = (partEq > 0 ? part.slice(0, partEq) : part).trim().toLowerCase()
    const v = partEq > 0 ? part.slice(partEq + 1).trim() : ''

    if (k === 'domain' && v) {
      cookie.domain = v
    } else if (k === 'path' && v) {
      cookie.path = v
    } else if (k === 'expires' && v) {
      const ms = Date.parse(v)
      if (!Number.isNaN(ms)) {
        cookie.expirationDate = Math.floor(ms / 1000)
      }
    } else if (k === 'max-age' && v) {
      const sec = Number.parseInt(v, 10)
      if (!Number.isNaN(sec)) {
        cookie.expirationDate = Math.floor(Date.now() / 1000) + sec
      }
    } else if (k === 'secure') {
      cookie.secure = true
    } else if (k === 'httponly') {
      cookie.httpOnly = true
    } else if (k === 'samesite' && v) {
      cookie.sameSite = normalizeSameSite(v) ?? 'lax'
    }
  }

  if (cookie.sameSite === 'no_restriction') {
    cookie.secure = true
  }

  return cookie
}

/**
 * 智能解析 Raw 格式 Cookies（支持 JSON 数组/对象、Set-Cookie、多项 Request Header 等）
 */
export function parseRawCookie(
  raw: string,
  defaultDomain?: string,
  defaultPath = '/',
): { ok: true; cookies: CookieSetDetails[] } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: '输入内容为空' }
  }

  // 1. 尝试 JSON 格式
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const items = Array.isArray(parsed) ? parsed : [parsed]
      if (items.length === 0) {
        return { ok: false, error: 'JSON 数组为空' }
      }
      const cookies: CookieSetDetails[] = []
      for (const item of items) {
        if (!item || typeof item !== 'object') {
          return { ok: false, error: 'JSON 条目格式错误（需为对象）' }
        }
        const obj = item as Record<string, unknown>
        const name = String(obj.name ?? obj.Name ?? obj.key ?? '').trim()
        if (!name) {
          return { ok: false, error: 'JSON 条目缺少 name 字段' }
        }
        const value = String(obj.value ?? obj.Value ?? '')
        const domain = obj.domain != null ? String(obj.domain).trim() : defaultDomain
        const path = obj.path != null ? String(obj.path).trim() : defaultPath
        const secure = Boolean(obj.secure)
        const httpOnly = Boolean(obj.httpOnly ?? obj.httponly)
        const sameSite =
          normalizeSameSite(obj.sameSite != null ? String(obj.sameSite) : undefined) ?? 'lax'
        let expirationDate: number | undefined
        if (typeof obj.expirationDate === 'number') {
          expirationDate = Math.floor(obj.expirationDate)
        } else if (typeof obj.expires === 'number') {
          expirationDate = Math.floor(obj.expires)
        } else if (typeof obj.expires === 'string') {
          const ms = Date.parse(obj.expires)
          if (!Number.isNaN(ms)) expirationDate = Math.floor(ms / 1000)
        }

        cookies.push({
          name,
          value,
          domain,
          path,
          secure: sameSite === 'no_restriction' ? true : secure,
          httpOnly,
          sameSite,
          expirationDate,
        })
      }
      return { ok: true, cookies }
    } catch (e) {
      // 若 JSON 解析报错，若开头明显是 JSON 则直接报 JSON 错误，避免误判
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return { ok: false, error: `JSON 语法错误: ${e instanceof Error ? e.message : String(e)}` }
      }
    }
  }

  // 2. 文本模式：按行拆分，处理每行
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const cookies: CookieSetDetails[] = []

  for (const rawLine of lines) {
    let line = rawLine
    if (line.toLowerCase().startsWith('set-cookie:')) {
      line = line.slice('set-cookie:'.length).trim()
    } else if (line.toLowerCase().startsWith('cookie:')) {
      line = line.slice('cookie:'.length).trim()
    }

    // 检查本行是单项带属性的 Set-Cookie 还是分号拼接的多项 key=val
    const semicolonParts = line
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
    const hasAttr = semicolonParts.slice(1).some((p) => {
      const eq = p.indexOf('=')
      const k = (eq > 0 ? p.slice(0, eq) : p).trim().toLowerCase()
      return KNOWN_ATTRS.has(k)
    })

    if (hasAttr) {
      const parsed = parseSetCookieLine(line, defaultDomain, defaultPath)
      if (parsed) cookies.push(parsed)
    } else {
      // 纯键值串：a=1; b=2; c=3
      for (const pair of semicolonParts) {
        const eq = pair.indexOf('=')
        if (eq > 0) {
          const name = pair.slice(0, eq).trim()
          const value = pair.slice(eq + 1).trim()
          if (name) {
            cookies.push({
              name,
              value,
              domain: defaultDomain,
              path: defaultPath,
              secure: false,
              httpOnly: false,
              sameSite: 'lax',
            })
          }
        }
      }
    }
  }

  if (cookies.length === 0) {
    return { ok: false, error: '未识别出合法的 Cookie 键值对（例如 name=value）' }
  }

  return { ok: true, cookies }
}
