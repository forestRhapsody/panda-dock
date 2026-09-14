/**
 * Panda Dock 扩展打包脚本。
 *
 * 职责：
 * 1. 严格校验 package.json、public/manifest.json 与 dist/manifest.json 版本号一致性；
 * 2. 将 dist/ 产物打包为标准 ZIP 文件：release/panda-dock-v<version>.zip；
 * 3. 纯 Node.js 内置模块（node:zlib, node:fs, node:path）实现，无外部依赖，跨平台安全可用；
 * 4. 支持 GitHub Actions CI 环境（自动追加输出至 $GITHUB_OUTPUT）。
 *
 * 用法：
 *   pnpm package
 *   node scripts/package.mjs
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = resolve(rootDir, 'dist')
const releaseDir = resolve(rootDir, 'release')

/** 将 Date 转换为 DOS 格式时间与日期（ZIP 头部标准） */
function toDosDateTime(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const year = Math.max(1980, d.getFullYear())
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const seconds = Math.floor(d.getSeconds() / 2)

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f)
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f)
  return { dosTime, dosDate }
}

/** 递归收集目录下的全部文件，忽略系统级冗余文件 */
function collectFiles(dir, baseDir = dir) {
  const entries = []
  const items = readdirSync(dir, { withFileTypes: true })
  items.sort((a, b) => a.name.localeCompare(b.name))

  for (const item of items) {
    if (item.name === '.DS_Store' || item.name === 'Thumbs.db' || item.name.startsWith('._')) {
      continue
    }
    const fullPath = join(dir, item.name)
    if (item.isDirectory()) {
      entries.push(...collectFiles(fullPath, baseDir))
    } else if (item.isFile()) {
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/')
      const stat = statSync(fullPath)
      const data = readFileSync(fullPath)
      entries.push({
        name: relPath,
        data,
        mtime: stat.mtime,
      })
    }
  }
  return entries
}

/**
 * 依据 PKWARE ZIP 规范生成二进制 ZIP Buffer。
 * 针对 Chrome 扩展要求，保证 manifest.json 位于根目录，不依赖任何第三方 npm 库。
 */
export function createZipBuffer(entries) {
  const localHeaders = []
  const centralHeaders = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8')
    const dataBuf = entry.data
    const crc = crc32(dataBuf) >>> 0
    const uncompressedSize = dataBuf.length

    let compressedData =
      uncompressedSize === 0 ? Buffer.alloc(0) : deflateRawSync(dataBuf, { level: 9 })
    let method = 8
    // 若压缩后比原体积还大（如某些极小或已压缩的文件），回退为存储模式 (method 0)
    if (compressedData.length >= uncompressedSize) {
      compressedData = dataBuf
      method = 0
    }
    const compressedSize = compressedData.length
    const { dosTime, dosDate } = toDosDateTime(entry.mtime)

    // Local file header (30 字节)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0) // Signature
    localHeader.writeUInt16LE(20, 4) // Version needed (2.0)
    localHeader.writeUInt16LE(0x0800, 6) // Flags: UTF-8 filename (bit 11)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compressedSize, 18)
    localHeader.writeUInt32LE(uncompressedSize, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28) // Extra field length

    localHeaders.push(localHeader, nameBuf, compressedData)

    // Central directory header (46 字节)
    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0) // Signature
    centralHeader.writeUInt16LE(20, 4) // Version made by
    centralHeader.writeUInt16LE(20, 6) // Version needed
    centralHeader.writeUInt16LE(0x0800, 8) // Flags: UTF-8
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressedSize, 20)
    centralHeader.writeUInt32LE(uncompressedSize, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30) // Extra field length
    centralHeader.writeUInt16LE(0, 32) // Comment length
    centralHeader.writeUInt16LE(0, 34) // Disk number start
    centralHeader.writeUInt16LE(0, 36) // Internal attributes
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38) // External attributes: rw-r--r--
    centralHeader.writeUInt32LE(offset, 42) // Local header relative offset

    centralHeaders.push(centralHeader, nameBuf)

    offset += localHeader.length + nameBuf.length + compressedData.length
  }

  const centralDirOffset = offset
  const centralDirSize = centralHeaders.reduce((acc, b) => acc + b.length, 0)

  // End of central directory record (22 字节)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // Signature
  eocd.writeUInt16LE(0, 4) // Disk number
  eocd.writeUInt16LE(0, 6) // Start disk
  eocd.writeUInt16LE(entries.length, 8) // Entries on this disk
  eocd.writeUInt16LE(entries.length, 10) // Total entries
  eocd.writeUInt32LE(centralDirSize, 12)
  eocd.writeUInt32LE(centralDirOffset, 16)
  eocd.writeUInt16LE(0, 20) // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd])
}

/** 执行打包全流程 */
function run() {
  console.log('📦 开始打包 Panda Dock 扩展压缩包...')

  // 1. 读取版本并校验
  const pkgPath = resolve(rootDir, 'package.json')
  const manifestPath = resolve(rootDir, 'public/manifest.json')
  const distManifestPath = join(distDir, 'manifest.json')

  if (!existsSync(pkgPath)) {
    throw new Error('未找到 package.json 文件')
  }
  if (!existsSync(manifestPath)) {
    throw new Error('未找到 public/manifest.json 文件')
  }
  if (!existsSync(distManifestPath)) {
    throw new Error('未找到 dist/manifest.json，请先执行 `pnpm build` 完成构建')
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const distManifest = JSON.parse(readFileSync(distManifestPath, 'utf8'))

  const version = pkg.version
  if (!version) {
    throw new Error('package.json 中缺少 version 字段')
  }

  if (pkg.version !== manifest.version) {
    throw new Error(
      `版本不一致：package.json (${pkg.version}) 与 public/manifest.json (${manifest.version})，请先同步版本号。`,
    )
  }

  if (pkg.version !== distManifest.version) {
    throw new Error(
      `dist 产物版本 (${distManifest.version}) 与源码版本 (${pkg.version}) 不一致，请重新执行 \`pnpm build\`。`,
    )
  }

  console.log(`✔ 版本校验通过：v${version}`)

  // 2. 收集 dist 文件
  const entries = collectFiles(distDir)
  if (entries.length === 0) {
    throw new Error('dist/ 目录下无任何文件')
  }

  const hasRootManifest = entries.some((e) => e.name === 'manifest.json')
  if (!hasRootManifest) {
    throw new Error('dist 产物根目录缺少 manifest.json，无法制作 Chrome 扩展压缩包')
  }

  console.log(`✔ 已扫描 dist/ 产物：共 ${entries.length} 个文件`)

  // 3. 打包 ZIP
  const zipBuffer = createZipBuffer(entries)
  mkdirSync(releaseDir, { recursive: true })

  const archiveName = `${pkg.name}-v${version}.zip`
  const archivePath = join(releaseDir, archiveName)
  writeFileSync(archivePath, zipBuffer)

  const sizeKb = (zipBuffer.length / 1024).toFixed(1)
  console.log(`✔ 压缩包已生成：${relative(rootDir, archivePath)} (${sizeKb} KB)`)

  // 4. GitHub Actions CI 集成：输出变量给后续步骤
  if (process.env.GITHUB_OUTPUT) {
    try {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `version=${version}\narchive_name=${archiveName}\narchive_path=${archivePath}\n`,
      )
      console.log(`✔ 已写入 GitHub Actions 输出变量 ($GITHUB_OUTPUT)`)
    } catch (err) {
      console.warn(`⚠ 写入 GITHUB_OUTPUT 失败:`, err)
    }
  }

  console.log(`🎉 打包完成：${archiveName}`)
}

export { run, collectFiles, toDosDateTime }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run()
}
