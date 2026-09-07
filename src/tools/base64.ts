const BASE64_RE = /^[A-Za-z0-9+/_-]*={0,2}$/
const CHUNK = 0x8000

function bytesToBinary(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return binary
}

/** 文本（UTF-8）→ Base64 */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return btoa(bytesToBinary(bytes))
}

export interface DecodeResult {
  text: string
  /** 是否按 UTF-8 文本成功解码（false 表示非文本字节，按原始字符展示） */
  isText: boolean
}

/** 粗略判断一段输入是否像 Base64（支持标准及 URL-safe Base64） */
export function isLikelyBase64(input: string): boolean {
  const s = input.replace(/\s+/g, '')
  if (s.length === 0 || !BASE64_RE.test(s)) return false
  // 长度对 4 取模：允许 0（已填充）或 2, 3（允许未填充），取模为 1 为非法长度
  return s.length % 4 !== 1
}

/** Base64 → 文本；自动忽略换行/空白；兼容 URL-safe 与无 padding 格式；优先按 UTF-8 解码，失败则按原始字节展示 */
export function decodeBase64(input: string): DecodeResult {
  let clean = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (clean.length % 4 === 1) {
    throw new Error('不是有效的 Base64：字符集或长度不正确')
  }
  if (clean.length % 4 !== 0) {
    clean = clean + '='.repeat((4 - (clean.length % 4)) % 4)
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error('不是有效的 Base64：字符集或长度不正确')
  }
  let binary: string
  try {
    binary = atob(clean)
  } catch {
    throw new Error('解码失败：包含非法字符')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, isText: true }
  } catch {
    // 非 UTF-8 文本（如图片字节）：按原始字节转为可读字符展示
    return { text: bytesToBinary(bytes), isText: false }
  }
}
