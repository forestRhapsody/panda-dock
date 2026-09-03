/**
 * 生成扩展占位图标（public/icons/icon{16,32,48,128}.png）。
 * 纯 Node 内置模块实现 PNG 编码，无第三方依赖。
 * 用法：pnpm icons
 * 之后替换为你的正式图标即可（保持同名，manifest 无需改动）。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons')
const SIZES = [16, 32, 48, 128]

// —— 极简 PNG 编码器（RGBA、8bit） ——
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 圆角方块背景 + 白色「T」字 */
function draw(size) {
  const px = Buffer.alloc(size * size * 4)
  const radius = size * 0.22
  const half = size / 2
  const inner = half - radius

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 圆角矩形判定
      const qx = Math.abs(x + 0.5 - half) - inner
      const qy = Math.abs(y + 0.5 - half) - inner
      const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
      const inside = dist <= radius

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      if (inside) {
        // 背景色 #4F7CFF
        r = 79
        g = 124
        b = 255
        a = 255
        const nx = (x + 0.5) / size
        const ny = (y + 0.5) / size
        const bar = ny >= 0.3 && ny <= 0.44 && nx >= 0.24 && nx <= 0.76
        const stem = nx >= 0.44 && nx <= 0.56 && ny >= 0.3 && ny <= 0.72
        if (bar || stem) {
          r = 255
          g = 255
          b = 255
        }
      }
      const i = (y * size + x) * 4
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = a
    }
  }
  return encodePng(size, px)
}

mkdirSync(outDir, { recursive: true })
for (const size of SIZES) {
  writeFileSync(resolve(outDir, `icon${size}.png`), draw(size))
  console.log(`generated public/icons/icon${size}.png`)
}
