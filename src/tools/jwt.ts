export interface JwtDecoded {
  headerText: string
  payloadText: string
  signatureB64: string
  claims: ClaimRow[]
}

export interface ClaimRow {
  key: string
  display: string
}

export type JwtResult = { ok: true; data: JwtDecoded } | { ok: false; error: string }

const DATE_CLAIMS = new Set(['exp', 'nbf', 'iat'])

/** Base64URL 段 → UTF-8 文本（JWT 的 header/payload 是 JSON 文本） */
function decodeSegment(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(`${what}不是合法 JSON：${message}`)
  }
}

function toSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 把标准时间类声明转成人类可读时间；非时间返回 null */
function humanizeClaimValue(key: string, value: unknown): string | null {
  if (!DATE_CLAIMS.has(key)) return null
  const secs = toSeconds(value)
  if (secs == null) return null
  const d = new Date(secs * 1000)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
}

function buildClaims(payload: unknown): ClaimRow[] {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return []
  const record = payload as Record<string, unknown>
  const keys = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti']
  const rows: ClaimRow[] = []
  for (const key of keys) {
    const value = record[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      continue
    const readable = humanizeClaimValue(key, value)
    rows.push({ key, display: readable ?? String(value) })
  }
  return rows
}

/**
 * 解码 JWT（不校验签名）：token = header.payload.signature（均为 Base64URL）。
 */
export function decodeJwt(token: string): JwtResult {
  const parts = token.trim().split('.')
  if (parts.length !== 3) {
    return {
      ok: false,
      error: `JWT 应包含 header.payload.signature 三段，当前为 ${parts.length} 段`,
    }
  }
  const [headerSeg, payloadSeg, signatureSeg] = parts
  if (!headerSeg || !payloadSeg || !signatureSeg) {
    return { ok: false, error: 'JWT 存在空白段：header.payload.signature 三段都不能为空' }
  }
  if (!/^[A-Za-z0-9_-]+$/.test(headerSeg) || !/^[A-Za-z0-9_-]+$/.test(payloadSeg)) {
    return { ok: false, error: 'JWT 段包含非法字符（应为 Base64URL 字符集）' }
  }

  try {
    const header = parseJson(decodeSegment(headerSeg), 'Header ')
    const payload = parseJson(decodeSegment(payloadSeg), 'Payload ')
    return {
      ok: true,
      data: {
        headerText: JSON.stringify(header, null, 2),
        payloadText: JSON.stringify(payload, null, 2),
        signatureB64: signatureSeg,
        claims: buildClaims(payload),
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 一段标准示例 JWT（便于体验） */
export const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE4MDE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
