/**
 * 共享的文件工具：识别 base64 文件类型（魔数）、格式化大小、默认下载名、触发下载。
 * 供「File → Base64」工具与「智能识别」共用，避免各写一套。
 * 纯本地处理，不产生网络请求。
 */

/** 字节数 → 人性化大小 */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** MIME → 常用文件扩展名（不含点）；未知返回 'bin' */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
  'application/json': 'json',
  'text/plain': 'txt',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/wasm': 'wasm',
  'application/vnd.sqlite3': 'sqlite',
}

export function mimeExt(mime: string): string {
  return MIME_EXT[mime] ?? 'bin'
}

/** 由 MIME 生成一个合理的默认下载文件名（base64 本身不含原文件名） */
export function defaultFileName(mime: string): string {
  const ext = mimeExt(mime)
  if (mime.startsWith('image/')) return `image.${ext}`
  if (mime === 'application/pdf') return 'document.pdf'
  if (mime === 'application/json') return 'data.json'
  if (mime === 'text/plain') return 'document.txt'
  if (ext === 'bin') return 'file.bin'
  return `file.${ext}`
}

/**
 * 取 base64 前 64 字节，按文件头魔数猜测 MIME；识别不出返回 null。
 * 覆盖常见图片 / 压缩包 / 文档 / 音视频 / wasm / sqlite 等。
 */
export function detectMimeFromBytes(base64: string): string | null {
  try {
    const bin = atob(base64.slice(0, 64))
    const b = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
    const ascii = (offset: number, len: number) =>
      String.fromCharCode(...b.subarray(offset, offset + len))
    const starts = (sig: number[]) => sig.every((v, i) => b[i] === v)
    if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
    if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
    if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif'
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
    if (ascii(0, 2) === 'BM') return 'image/bmp'
    if (ascii(0, 5) === '%PDF-') return 'application/pdf'
    if (ascii(0, 4) === 'PK\x03\x04' || ascii(0, 4) === 'PK\x05\x06') return 'application/zip'
    if (starts([0x1f, 0x8b])) return 'application/gzip'
    if (ascii(0, 7) === 'Rar!\x1a\x07') return 'application/vnd.rar'
    if (ascii(0, 6) === '7z\xbc\xaf\x27\x1c') return 'application/x-7z-compressed'
    if (ascii(0, 3) === 'ID3') return 'audio/mpeg'
    if (ascii(4, 4) === 'ftyp') return 'video/mp4'
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'audio/wav'
    if (starts([0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm'
    if (ascii(0, 4) === 'OggS') return 'audio/ogg'
    if (ascii(0, 4) === '\x00asm') return 'application/wasm'
    if (ascii(0, 15) === 'SQLite format 3\x00') return 'application/vnd.sqlite3'
    return null
  } catch {
    return null
  }
}

/** 裸 base64 + MIME → Data URL */
export function base64ToDataUrl(base64: string, mime: string): string {
  return `data:${mime};base64,${base64}`
}

/**
 * 触发浏览器下载：把 Data URL 还原为原始字节，包成 Blob 后经临时 <a download> 下载。
 * 临时锚点即刻移除，不会污染宿主页面；下载需用户手势（点击触发），content script 里同样可用。
 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const base64 = dataUrl.split(',')[1] ?? ''
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const mime = dataUrl.match(/^data:([^;,]+)/)?.[1] ?? 'application/octet-stream'
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
