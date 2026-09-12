/**
 * 哈希计算与校验和纯逻辑模块：
 * - 纯 TypeScript 实现轻量零依赖的标准 MD5 算法（RFC 1321），支持 UTF-8 字符串与 Uint8Array / ArrayBuffer；
 * - 基于 Web Crypto API（crypto.subtle.digest）原生硬件加速计算 SHA-1 / SHA-256 / SHA-512；
 * - 支持文本加盐（HMAC-MD5、HMAC-SHA1、HMAC-SHA256、HMAC-SHA512）；
 * - 支持文件校验和计算与校验和智能比对（Checksum Matcher）。
 */

export type HashAlgorithmName = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-512'

export interface HashResult {
  md5: string
  sha1: string
  sha256: string
  sha512: string
}

export interface MatchResult {
  matched: boolean
  algorithm?: HashAlgorithmName
  expected: string
}

/* ==========================================================================
   1. 轻量纯 TypeScript MD5 算法实现（RFC 1321）
   ========================================================================== */

/** 常量表 K[0..63] = floor(abs(sin(i + 1)) * 2^32) */
const K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
])

/** 循环左移位数 S[0..63] */
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

/** 对 Uint8Array 进行标准 MD5 计算，返回 16 字节 Uint8Array */
export function md5Raw(data: Uint8Array): Uint8Array {
  const originalLength = data.length
  // 长度需要 padding 使得 length % 64 === 56
  const padLength = (originalLength % 64 < 56 ? 56 : 120) - (originalLength % 64)
  const totalLength = originalLength + padLength + 8
  const padded = new Uint8Array(totalLength)
  padded.set(data, 0)
  padded[originalLength] = 0x80

  // 原始长度（bits，64 位小端序整数）
  const bitsLow = (originalLength * 8) >>> 0
  const bitsHigh = Math.floor((originalLength * 8) / 0x100000000) >>> 0
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength)
  view.setUint32(totalLength - 8, bitsLow, true)
  view.setUint32(totalLength - 4, bitsHigh, true)

  let a = 0x67452301 >>> 0
  let b = 0xefcdab89 >>> 0
  let c = 0x98badcfe >>> 0
  let d = 0x10325476 >>> 0

  const m = new Uint32Array(16)

  for (let offset = 0; offset < totalLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      m[i] = view.getUint32(offset + i * 4, true)
    }

    let aa = a
    let bb = b
    let cc = c
    let dd = d

    for (let i = 0; i < 64; i++) {
      let f = 0
      let g = 0
      if (i < 16) {
        f = (bb & cc) | (~bb & dd)
        g = i
      } else if (i < 32) {
        f = (dd & bb) | (~dd & cc)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = bb ^ cc ^ dd
        g = (3 * i + 5) % 16
      } else {
        f = cc ^ (bb | ~dd)
        g = (7 * i) % 16
      }
      f = (f + aa + K[i] + m[g]) >>> 0
      aa = dd
      dd = cc
      cc = bb
      bb = (bb + rotl(f, S[i])) >>> 0
    }

    a = (a + aa) >>> 0
    b = (b + bb) >>> 0
    c = (c + cc) >>> 0
    d = (d + dd) >>> 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a, true)
  outView.setUint32(4, b, true)
  outView.setUint32(8, c, true)
  outView.setUint32(12, d, true)
  return out
}

/** 计算 Uint8Array 的 MD5 并输出 32 位 Hex 字符串 */
export function md5(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return bytesToHex(md5Raw(bytes))
}

/* ==========================================================================
   2. 辅助工具与 Hex 格式化
   ========================================================================== */

/** 将二进制字节转为十六进制小写字符串 */
export function bytesToHex(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let hex = ''
  for (let i = 0; i < u8.length; i++) {
    const b = u8[i]
    hex += (b < 16 ? '0' : '') + b.toString(16)
  }
  return hex
}

/* ==========================================================================
   3. Web Crypto API 原生 SHA 系列与 HMAC 计算
   ========================================================================== */

/** 计算 ArrayBuffer 的 SHA 散列 */
async function digestSubtle(
  algo: 'SHA-1' | 'SHA-256' | 'SHA-512',
  data: Uint8Array,
): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(algo, data)
  return bytesToHex(hashBuffer)
}

/** HMAC-MD5 实现（RFC 2104） */
function hmacMd5(key: Uint8Array, message: Uint8Array): string {
  const blockSize = 64
  let k = key
  if (k.length > blockSize) {
    k = md5Raw(k)
  }
  const paddedKey = new Uint8Array(blockSize)
  paddedKey.set(k, 0)

  const ipad = new Uint8Array(blockSize + message.length)
  const opad = new Uint8Array(blockSize + 16) // md5 输出 16 字节

  for (let i = 0; i < blockSize; i++) {
    ipad[i] = paddedKey[i] ^ 0x36
    opad[i] = paddedKey[i] ^ 0x5c
  }
  ipad.set(message, blockSize)

  const innerHash = md5Raw(ipad)
  opad.set(innerHash, blockSize)

  return bytesToHex(md5Raw(opad))
}

/** HMAC-SHA 系列实现（Web Crypto 原生） */
async function hmacSha(
  algo: 'SHA-1' | 'SHA-256' | 'SHA-512',
  key: Uint8Array,
  message: Uint8Array,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: { name: algo } },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message)
  return bytesToHex(signature)
}

/* ==========================================================================
   4. 综合计算 API（文本与文件）
   ========================================================================== */

export interface ComputeOptions {
  /** 可选的 HMAC 密钥（为空时不加盐，走标准哈希） */
  hmacKey?: string
  /** 是否转为大写 Hex（默认 false） */
  uppercase?: boolean
}

/** 格式化 Hex 结果大小写 */
function formatResult(raw: HashResult, uppercase?: boolean): HashResult {
  if (!uppercase) return raw
  return {
    md5: raw.md5.toUpperCase(),
    sha1: raw.sha1.toUpperCase(),
    sha256: raw.sha256.toUpperCase(),
    sha512: raw.sha512.toUpperCase(),
  }
}

/** 计算字符串文本哈希 */
export async function computeTextHash(text: string, options?: ComputeOptions): Promise<HashResult> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const keyStr = options?.hmacKey?.trim()

  if (keyStr) {
    const key = encoder.encode(keyStr)
    const [m5, s1, s256, s512] = await Promise.all([
      Promise.resolve(hmacMd5(key, data)),
      hmacSha('SHA-1', key, data),
      hmacSha('SHA-256', key, data),
      hmacSha('SHA-512', key, data),
    ])
    return formatResult({ md5: m5, sha1: s1, sha256: s256, sha512: s512 }, options?.uppercase)
  }

  const [m5, s1, s256, s512] = await Promise.all([
    Promise.resolve(md5(data)),
    digestSubtle('SHA-1', data),
    digestSubtle('SHA-256', data),
    digestSubtle('SHA-512', data),
  ])

  return formatResult({ md5: m5, sha1: s1, sha256: s256, sha512: s512 }, options?.uppercase)
}

/**
 * 文件哈希的体积上限：超过直接拒绝。
 * 原因：`crypto.subtle` 没有流式接口、`file.arrayBuffer()` 必须整块读入，
 * 因此体积上限实际就是「一次能安全放进内存的字节数」。牺牲的是超大文件（如数 GB 镜像）
 * 的校验能力——那种场景请改用系统自带的 sha256sum / md5sum。
 */
export const HASH_FILE_MAX_BYTES = 256 * 1024 * 1024

/**
 * 超过该体积则跳过纯 JS 实现的 MD5，只保留 Web Crypto 的原生 SHA 系列。
 * 依据实测：本机（现代桌面 CPU）JS MD5 吞吐约 80 MB/s，32 MB 约需 0.4 s，
 * 低端机按 2~4 倍估算约 0.8~1.6 s——再大就会明显阻塞主线程（原生 SHA 由浏览器在别的线程完成）。
 */
export const HASH_FILE_MD5_SKIP_BYTES = 32 * 1024 * 1024

export type FileHashOutcome =
  | {
      ok: true
      hashes: HashResult
      /** 文件超过 HASH_FILE_MD5_SKIP_BYTES，MD5（hashes.md5 为空串）未计算 */
      md5Skipped: boolean
    }
  | {
      ok: false
      reason: 'too-large'
      sizeBytes: number
      maxBytes: number
    }

/**
 * 计算文件二进制哈希。
 * - 超过 {@link HASH_FILE_MAX_BYTES}：拒绝计算（返回 ok:false），避免一次性读入导致内存暴涨；
 * - 超过 {@link HASH_FILE_MD5_SKIP_BYTES}：跳过纯 JS 的 MD5，只算原生 SHA，避免长时间占用主线程；
 * - 先发起三个原生 SHA（浏览器侧执行），MD5 放在其后同步计算，避免 MD5 先把主线程占满。
 */
export async function computeFileHash(
  file: File,
  options?: { uppercase?: boolean },
): Promise<FileHashOutcome> {
  if (file.size > HASH_FILE_MAX_BYTES) {
    return {
      ok: false,
      reason: 'too-large',
      sizeBytes: file.size,
      maxBytes: HASH_FILE_MAX_BYTES,
    }
  }

  const buffer = await file.arrayBuffer()
  const data = new Uint8Array(buffer)
  const md5Skipped = file.size > HASH_FILE_MD5_SKIP_BYTES

  const [s1, s256, s512] = await Promise.all([
    digestSubtle('SHA-1', data),
    digestSubtle('SHA-256', data),
    digestSubtle('SHA-512', data),
  ])
  const m5 = md5Skipped ? '' : md5(data)

  return {
    ok: true,
    md5Skipped,
    hashes: formatResult({ md5: m5, sha1: s1, sha256: s256, sha512: s512 }, options?.uppercase),
  }
}

/* ==========================================================================
   5. 校验和比对器（Checksum Matcher）
   ========================================================================== */

/**
 * 校验和智能比对：比对用户输入的期望值与各算法的实际结果
 * 自动去除首尾空格，不区分大小写；空哈希（如超限时跳过的 MD5）不参与比对。
 */
export function matchChecksum(expected: string, hashes: HashResult | null): MatchResult {
  const trimmed = expected.trim().toLowerCase()
  if (!trimmed || !hashes) {
    return { matched: false, expected: '' }
  }

  const candidates: [HashAlgorithmName, string][] = [
    ['MD5', hashes.md5],
    ['SHA-1', hashes.sha1],
    ['SHA-256', hashes.sha256],
    ['SHA-512', hashes.sha512],
  ]
  for (const [algorithm, value] of candidates) {
    if (value && value.toLowerCase() === trimmed) {
      return { matched: true, algorithm, expected: trimmed }
    }
  }

  return { matched: false, expected: trimmed }
}
