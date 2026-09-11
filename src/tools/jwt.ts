import i18n from '@/i18n'

export interface ClaimHint {
  expired: boolean
  text: string
}

export interface ClaimRow {
  key: string
  label: string
  display: string
  hint?: ClaimHint
}

export interface JwtDecoded {
  headerText: string
  payloadText: string
  signatureB64: string
  claims: ClaimRow[]
  alg: string
}

export type JwtResult = { ok: true; data: JwtDecoded } | { ok: false; error: string }

const DATE_CLAIMS = new Set(['exp', 'nbf', 'iat'])

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 格式化为清晰规范的本地日期时间 YYYY-MM-DD HH:mm:ss */
export function formatDateTime(secs: number): string {
  const d = new Date(secs * 1000)
  if (Number.isNaN(d.getTime())) return String(secs)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 获取声明的语义化显示标签 */
export function getClaimLabel(key: string): string {
  const i18nKey = `tool.jwt.claim.${key}`
  return i18n.t(i18nKey, { defaultValue: key })
}

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
    throw new Error(i18n.t('tool.jwt.errorNotJson', { what, message }))
  }
}

function toSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildClaimHint(key: string, secs: number, nowSec: number): ClaimHint | undefined {
  if (key === 'exp') {
    if (secs <= nowSec) {
      const diffDays = Math.floor((nowSec - secs) / 86400)
      if (diffDays >= 1) {
        return {
          expired: true,
          text: i18n.t('tool.jwt.hintExpiredDays', { count: diffDays }),
        }
      }
      return {
        expired: true,
        text: i18n.t('tool.jwt.hintExpired'),
      }
    }
    // 未过期
    const diffSec = secs - nowSec
    const diffDays = Math.floor(diffSec / 86400)
    if (diffDays >= 1) {
      return {
        expired: false,
        text: i18n.t('tool.jwt.hintDaysLeft', { count: diffDays }),
      }
    }
    const diffHours = Math.floor(diffSec / 3600)
    if (diffHours >= 1) {
      return {
        expired: false,
        text: i18n.t('tool.jwt.hintHoursLeft', { count: diffHours }),
      }
    }
    const diffMins = Math.max(1, Math.floor(diffSec / 60))
    return {
      expired: false,
      text: i18n.t('tool.jwt.hintMinsLeft', { count: diffMins }),
    }
  }

  if (key === 'nbf') {
    if (secs > nowSec) {
      const diffSec = secs - nowSec
      const diffDays = Math.floor(diffSec / 86400)
      if (diffDays >= 1) {
        return {
          expired: false,
          text: i18n.t('tool.jwt.hintStartsInDays', { count: diffDays }),
        }
      }
      const diffHours = Math.floor(diffSec / 3600)
      if (diffHours >= 1) {
        return {
          expired: false,
          text: i18n.t('tool.jwt.hintStartsInHours', { count: diffHours }),
        }
      }
      const diffMins = Math.max(1, Math.floor(diffSec / 60))
      return {
        expired: false,
        text: i18n.t('tool.jwt.hintStartsInMins', { count: diffMins }),
      }
    }
    return undefined
  }

  if (key === 'iat') {
    const diffSec = Math.max(0, nowSec - secs)
    const diffDays = Math.floor(diffSec / 86400)
    if (diffDays >= 1) {
      return {
        expired: false,
        text: i18n.t('tool.jwt.hintIssuedDaysAgo', { count: diffDays }),
      }
    }
    const diffHours = Math.floor(diffSec / 3600)
    if (diffHours >= 1) {
      return {
        expired: false,
        text: i18n.t('tool.jwt.hintIssuedHoursAgo', { count: diffHours }),
      }
    }
    const diffMins = Math.floor(diffSec / 60)
    if (diffMins >= 1) {
      return {
        expired: false,
        text: i18n.t('tool.jwt.hintIssuedMinsAgo', { count: diffMins }),
      }
    }
    return {
      expired: false,
      text: i18n.t('tool.jwt.hintJustIssued'),
    }
  }

  return undefined
}

function buildClaims(payload: unknown): ClaimRow[] {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return []
  const record = payload as Record<string, unknown>
  const keys = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti']
  const now = Math.floor(Date.now() / 1000)
  const rows: ClaimRow[] = []
  for (const key of keys) {
    const value = record[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      continue
    }
    const label = getClaimLabel(key)
    if (DATE_CLAIMS.has(key)) {
      let secs = toSeconds(value)
      if (secs !== null) {
        if (secs > 1e11) secs = Math.floor(secs / 1000)
        const display = formatDateTime(secs)
        const hint = buildClaimHint(key, secs, now)
        rows.push({ key, label, display, hint })
        continue
      }
    }
    rows.push({ key, label, display: String(value) })
  }
  return rows
}

function getHeaderAlg(header: unknown): string {
  if (header && typeof header === 'object' && 'alg' in header) {
    const alg = (header as { alg?: unknown }).alg
    if (typeof alg === 'string' && alg) return alg
  }
  return i18n.t('tool.jwt.algUnknown')
}

/**
 * 解码 JWT（不校验签名）：token = header.payload.signature（自动清洗可选 Bearer 前缀）。
 */
export function decodeJwt(token: string): JwtResult {
  const clean = token
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim()
  const parts = clean.split('.')
  if (parts.length !== 3) {
    return {
      ok: false,
      error: i18n.t('tool.jwt.errorSegmentCount', { count: parts.length }),
    }
  }
  const [headerSeg, payloadSeg, signatureSeg] = parts
  if (!headerSeg || !payloadSeg || !signatureSeg) {
    return { ok: false, error: i18n.t('tool.jwt.errorEmptySegment') }
  }
  if (!/^[A-Za-z0-9_-]+$/.test(headerSeg) || !/^[A-Za-z0-9_-]+$/.test(payloadSeg)) {
    return { ok: false, error: i18n.t('tool.jwt.errorInvalidChars') }
  }

  try {
    const header = parseJson(decodeSegment(headerSeg), i18n.t('tool.jwt.header'))
    const payload = parseJson(decodeSegment(payloadSeg), i18n.t('tool.jwt.payload'))
    const alg = getHeaderAlg(header)
    return {
      ok: true,
      data: {
        headerText: JSON.stringify(header, null, 2),
        payloadText: JSON.stringify(payload, null, 2),
        signatureB64: signatureSeg,
        claims: buildClaims(payload),
        alg,
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
