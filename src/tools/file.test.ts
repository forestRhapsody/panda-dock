import { describe, expect, it } from 'vitest'

import { base64ToDataUrl, defaultFileName, detectMimeFromBytes, fmtSize } from './file'

/**
 * file.ts 是「File → Base64」与智能识别的共享底座：大小格式化、默认下载名、魔数识别
 * 任意一步算错，用户就会拿到错误扩展名的下载文件或 `file.bin`。
 * 因此这里把档位边界（1023/1024、1MB±、1GB±、0、负数）与每种魔数签名逐一钉死。
 */

/** 把字节数组编码成真实 base64；源码只取前 64 个字符交给 atob，短签名的填充形式也必须合法 */
function base64Of(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

/** 字符串 → 字节数组（用于构造魔数头部） */
function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0))
}

/** RIFF 容器：`RIFF` + 4 字节长度 + 类型标识（WEBP / WAVE） */
function riff(type: string): number[] {
  return [...ascii('RIFF'), 0x00, 0x00, 0x00, 0x00, ...ascii(type)]
}

/** ISO BMFF：4 字节长度 + `ftyp` + brand（MP4 之类） */
function ftyp(brand: string): number[] {
  return [0x00, 0x00, 0x00, 0x18, ...ascii('ftyp'), ...ascii(brand)]
}

describe('fmtSize 的大小分档边界', () => {
  it('小于 1024 字节走 B，0 与负数原样带出', () => {
    expect(fmtSize(0)).toBe('0 B')
    expect(fmtSize(1)).toBe('1 B')
    expect(fmtSize(1023)).toBe('1023 B')
    // 负数在业务上不该出现，但它是「不会被误判成 KB」的证据
    expect(fmtSize(-1)).toBe('-1 B')
  })

  it('1024 是 B → KB 的分界点，保留一位小数', () => {
    expect(fmtSize(1024)).toBe('1.0 KB')
    expect(fmtSize(1536)).toBe('1.5 KB')
  })

  it('1MB 前后分别是 KB 与 MB：1MB-1 四舍五入显示仍是 1024.0 KB', () => {
    expect(fmtSize(1024 * 1024 - 1)).toBe('1024.0 KB')
    expect(fmtSize(1024 * 1024)).toBe('1.00 MB')
  })

  it('1GB 前后分别是 MB 与 GB：1GB-1 四舍五入显示仍是 1024.00 MB', () => {
    expect(fmtSize(1024 * 1024 * 1024 - 1)).toBe('1024.00 MB')
    expect(fmtSize(1024 * 1024 * 1024)).toBe('1.00 GB')
  })

  it('GB 档保留两位小数且不设上限', () => {
    expect(fmtSize(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB')
  })
})

describe('defaultFileName 按 MIME 生成下载名', () => {
  it.each([
    ['image/png', 'image.png'],
    ['image/jpeg', 'image.jpg'],
    ['image/gif', 'image.gif'],
    ['image/webp', 'image.webp'],
    ['image/bmp', 'image.bmp'],
    ['image/svg+xml', 'image.svg'],
    ['application/pdf', 'document.pdf'],
    ['application/zip', 'file.zip'],
    ['application/gzip', 'file.gz'],
    ['application/vnd.rar', 'file.rar'],
    ['application/x-7z-compressed', 'file.7z'],
    ['application/json', 'data.json'],
    ['text/plain', 'document.txt'],
    ['audio/mpeg', 'file.mp3'],
    ['audio/wav', 'file.wav'],
    ['audio/ogg', 'file.ogg'],
    ['video/mp4', 'file.mp4'],
    ['video/webm', 'file.webm'],
    ['application/wasm', 'file.wasm'],
    ['application/vnd.sqlite3', 'file.sqlite'],
  ])('%s 映射到 %s', (mime, expected) => {
    expect(defaultFileName(mime)).toBe(expected)
  })

  it('未知 MIME 与空 MIME 都回退 file.bin', () => {
    expect(defaultFileName('application/octet-stream')).toBe('file.bin')
    expect(defaultFileName('')).toBe('file.bin')
  })

  it('未登记的 image/* 仍走 image 前缀，但扩展名退化为 bin', () => {
    expect(defaultFileName('image/tiff')).toBe('image.bin')
  })
})

describe('detectMimeFromBytes 的魔数识别', () => {
  it.each([
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'image/jpeg'],
    ['GIF87a', ascii('GIF87a'), 'image/gif'],
    ['GIF89a', ascii('GIF89a'), 'image/gif'],
    ['WEBP', riff('WEBP'), 'image/webp'],
    ['BMP', [...ascii('BM'), 0x36, 0x00], 'image/bmp'],
    ['PDF', ascii('%PDF-1.7'), 'application/pdf'],
    ['ZIP（本地文件头 PK\\x03\\x04）', [...ascii('PK\x03\x04'), 0x14, 0x00], 'application/zip'],
    ['ZIP（空归档 PK\\x05\\x06）', [...ascii('PK\x05\x06'), 0x00, 0x00], 'application/zip'],
    ['GZIP', [0x1f, 0x8b, 0x08, 0x00], 'application/gzip'],
    ['7z', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], 'application/x-7z-compressed'],
    ['MP3（ID3 头）', ascii('ID3\x04\x00\x00'), 'audio/mpeg'],
    ['MP4（ftyp）', ftyp('isom'), 'video/mp4'],
    ['WAV', riff('WAVE'), 'audio/wav'],
    ['WEBM', [0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00], 'video/webm'],
    ['OGG', ascii('OggS\x00\x02'), 'audio/ogg'],
    ['WASM', [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00], 'application/wasm'],
  ])('%s 头部识别为 %s', (_name, bytes, expected) => {
    expect(detectMimeFromBytes(base64Of(bytes))).toBe(expected)
  })

  it('SQLite 与 RAR 头都能识别（比较串长度必须与 ascii() 取长一致）', () => {
    // 回归：源码曾用 ascii(0, 15) 比较 16 字节的 'SQLite format 3\x00'、用 ascii(0, 7) 比较
    // 6 字节的 'Rar!\x1a\x07'，两处长度不匹配导致分支永不命中。这里按各自规范签名固定识别结果。
    const sqlite = [...ascii('SQLite format 3\x00'), 0x00, 0x00, 0x00]
    expect(detectMimeFromBytes(base64Of(sqlite))).toBe('application/vnd.sqlite3')

    const rar = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]
    expect(detectMimeFromBytes(base64Of(rar))).toBe('application/vnd.rar')
  })

  it('差一个字节的伪头不会被误判（长度必须精确匹配）', () => {
    // RAR 少结尾 \x00、SQLite 少结尾 \x00：都不构成合法签名
    expect(detectMimeFromBytes(base64Of([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]))).toBeNull()
    expect(detectMimeFromBytes(base64Of(ascii('SQLite format 3')))).toBeNull()
  })

  it('只解码前 64 个 base64 字符（48 字节），长文件同样能识别', () => {
    const long = base64Of([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...new Array(200).fill(0),
    ])
    expect(long.length).toBeGreaterThan(64)
    expect(detectMimeFromBytes(long)).toBe('image/png')
  })

  it('无法识别的字节流返回 null', () => {
    expect(detectMimeFromBytes(base64Of([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBeNull()
    expect(detectMimeFromBytes(base64Of(new Array(80).fill(0x42)))).toBeNull()
  })

  it('空串返回 null（而不是抛错）', () => {
    expect(detectMimeFromBytes('')).toBeNull()
  })

  it('非法 base64 返回 null（atob 抛错被吞掉）', () => {
    expect(detectMimeFromBytes('not-base64!!!')).toBeNull()
    expect(detectMimeFromBytes('a')).toBeNull()
  })

  it('合法但过短的 base64 返回 null', () => {
    expect(detectMimeFromBytes(btoa('hi'))).toBeNull()
  })
})

describe('base64ToDataUrl 拼接', () => {
  it('把裸 base64 与 MIME 拼成 Data URL', () => {
    expect(base64ToDataUrl('QUJD', 'image/png')).toBe('data:image/png;base64,QUJD')
  })

  it('原样透传 payload，不做编码或截断', () => {
    const payload = 'AA+/=='
    expect(base64ToDataUrl(payload, 'application/octet-stream')).toBe(
      `data:application/octet-stream;base64,${payload}`,
    )
  })
})
