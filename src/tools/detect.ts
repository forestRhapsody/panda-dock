import { decodeBase64 } from './base64'
import { base64ToDataUrl, detectMimeFromBytes, fmtSize } from './file'
import { formatJson, minifyJson } from './json'
import { decodeJwt } from './jwt'

export type DetectKind =
  | 'json'
  | 'jwt'
  | 'url'
  | 'timestamp'
  | 'uuid'
  | 'base64'
  | 'hex'
  | 'dataurl'

/** 短字段（单行 label|value，可逐项复制） */
export interface DetectField {
  key: string
  value: string
  mono?: boolean
}

/** 长文本输出（格式化 JSON / 解码结果，整块复制），json=true 用语法高亮展示，image=true 展示图片 */
export interface DetectBlock {
  key: string
  value: string
  json?: boolean
  image?: boolean
}

/** 可下载的文件（base64 反解成原始文件，点击可还原下载） */
export interface DetectDownload {
  mime: string
  /** Data URL（含 base64 数据），用于还原文件 */
  dataUrl: string
  sizeBytes: number
}

export interface DetectResult {
  kind: DetectKind
  fields: DetectField[]
  blocks: DetectBlock[]
  /** 主复制文本（优先取第一个 block，否则第一个 field） */
  copy: string
  /** 若输入是一段 Base64 / Data URL 文件，携带还原下载所需的信息 */
  download?: DetectDownload
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX_RE = /^[0-9a-fA-F]+$/
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/
const DATA_URL_RE = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'ws:', 'wss:', 'file:'])

function isJsonLike(s: string): boolean {
  return s.startsWith('{') || s.startsWith('[')
}

function detectJson(s: string): DetectResult | null {
  if (!isJsonLike(s)) return null
  const formatted = formatJson(s)
  if (!formatted.ok) return null
  const minified = minifyJson(s)
  const text = formatted.text ?? ''
  return {
    kind: 'json',
    fields: [],
    blocks: [
      { key: 'formatted', value: text, json: true },
      { key: 'minified', value: minified.text ?? '', json: false },
    ],
    copy: text,
  }
}

function detectJwt(s: string): DetectResult | null {
  if (s.split('.').length !== 3) return null
  const res = decodeJwt(s)
  if (!res.ok) return null
  const d = res.data
  let alg = ''
  try {
    alg = (JSON.parse(d.headerText) as { alg?: string }).alg ?? ''
  } catch {
    // 忽略
  }
  const fields: DetectField[] = []
  if (alg) fields.push({ key: 'algorithm', value: alg, mono: true })
  for (const c of d.claims) fields.push({ key: `claim.${c.key}`, value: c.display, mono: true })
  return {
    kind: 'jwt',
    fields,
    blocks: [
      { key: 'header', value: d.headerText, json: true },
      { key: 'payload', value: d.payloadText, json: true },
    ],
    copy: d.payloadText,
  }
}

function detectUrl(s: string): DetectResult | null {
  let url: URL | null = null
  try {
    url = new URL(s)
  } catch {
    // 无协议但像完整域名：补 https
    if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(s)) {
      try {
        url = new URL(`https://${s}`)
      } catch {
        url = null
      }
    }
  }
  if (!url || !ALLOWED_PROTOCOLS.has(url.protocol)) return null

  const fields: DetectField[] = []
  if (url.protocol) fields.push({ key: 'protocol', value: url.protocol, mono: true })
  if (url.host) fields.push({ key: 'host', value: url.host, mono: true })
  if (url.pathname && url.pathname !== '/')
    fields.push({ key: 'path', value: url.pathname, mono: true })
  if (url.search) fields.push({ key: 'search', value: url.search, mono: true })
  if (url.hash) fields.push({ key: 'hash', value: url.hash, mono: true })
  if (url.username) fields.push({ key: 'username', value: url.username, mono: true })
  if (url.password) fields.push({ key: 'password', value: url.password, mono: true })
  return { kind: 'url', fields, blocks: [], copy: url.href }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function detectTimestamp(s: string): DetectResult | null {
  if (!/^-?\d+$/.test(s)) return null
  const num = Number(s)
  const isSecs = s.replace(/^-/, '').length <= 10
  const ms = isSecs ? num * 1000 : num
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  if (date.getFullYear() < 1900 || date.getFullYear() > 2200) return null
  const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return {
    kind: 'timestamp',
    fields: [
      { key: 'seconds', value: String(Math.floor(date.getTime() / 1000)), mono: true },
      { key: 'milliseconds', value: String(date.getTime()), mono: true },
      { key: 'date', value: local },
      { key: 'iso', value: date.toISOString(), mono: true },
    ],
    blocks: [],
    copy: local,
  }
}

function detectUuid(s: string): DetectResult | null {
  const m = s.match(UUID_RE)
  if (!m) return null
  const ver = s.slice(14, 15)
  return {
    kind: 'uuid',
    fields: [
      { key: 'valid', value: '✓' },
      { key: 'version', value: `v${ver}` },
    ],
    blocks: [],
    copy: s,
  }
}

function detectBase64(s: string): DetectResult | null {
  const clean = s.replace(/\s+/g, '')
  if (clean.length < 8 || clean.length % 4 !== 0 || !B64_RE.test(clean)) return null
  try {
    const canonical = btoa(atob(clean)) === clean
    if (!canonical) return null
    const decoded = decodeBase64(clean)
    if (decoded.isText) {
      return {
        kind: 'base64',
        fields: [],
        blocks: [{ key: 'decoded', value: decoded.text }],
        copy: decoded.text,
      }
    }
    // 非 UTF-8 文本 = 二进制文件：按魔数识别类型并支持还原下载；图片直接预览
    const sizeBytes = atob(clean).length
    const mime = detectMimeFromBytes(clean) ?? 'application/octet-stream'
    const dataUrl = base64ToDataUrl(clean, mime)
    const blocks: DetectBlock[] = []
    if (mime.startsWith('image/')) {
      blocks.push({ key: 'image', value: dataUrl, image: true })
    } else {
      // 非图片二进制：按原始字节转十六进制展示（供查看）
      const binary = atob(clean)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')
      blocks.push({ key: 'decoded', value: hex })
    }
    return {
      kind: 'base64',
      fields: [{ key: 'bytes', value: fmtSize(sizeBytes), mono: true }],
      blocks,
      copy: dataUrl,
      download: { mime, dataUrl, sizeBytes },
    }
  } catch {
    return null
  }
}

function detectHex(s: string): DetectResult | null {
  if (s.length < 8 || s.length % 2 !== 0 || !HEX_RE.test(s)) return null
  const groups = s.match(/.{2}/g)
  if (!groups) return null
  const bytes = new Uint8Array(groups.map((g) => parseInt(g, 16)))
  let ascii = ''
  for (const b of bytes) ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '·'
  return {
    kind: 'hex',
    fields: [{ key: 'bytes', value: `${bytes.length} B`, mono: true }],
    blocks: [{ key: 'decoded', value: ascii }],
    copy: ascii,
  }
}

/** Data URL：data:<mime>;base64,<base64> —— 识别类型，图片会展示预览 */
function detectDataUrl(s: string): DetectResult | null {
  const m = s.match(DATA_URL_RE)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const b64 = m[2].replace(/\s+/g, '')
  if (b64.length < 4 || b64.length % 4 !== 0 || !B64_RE.test(b64)) return null
  let sizeBytes = 0
  try {
    sizeBytes = atob(b64).length
  } catch {
    return null
  }
  const cleanUrl = `data:${mime};base64,${b64}`
  const isImg = mime.startsWith('image/')
  return {
    kind: 'dataurl',
    fields: [
      { key: 'mime', value: mime, mono: true },
      { key: 'bytes', value: fmtSize(sizeBytes), mono: true },
    ],
    blocks: isImg ? [{ key: 'image', value: cleanUrl, image: true }] : [],
    copy: cleanUrl,
    download: { mime, dataUrl: cleanUrl, sizeBytes },
  }
}

/** 入口：对一段输入做保守检测，返回首个命中的类型结果；识别不出返回 null */
export function detect(input: string): DetectResult | null {
  const s = input.trim()
  if (!s) return null
  return (
    detectJson(s) ??
    detectDataUrl(s) ??
    detectJwt(s) ??
    detectUrl(s) ??
    detectTimestamp(s) ??
    detectUuid(s) ??
    detectBase64(s) ??
    detectHex(s)
  )
}
