import { describe, expect, it } from 'vitest'

import pkg from '../../package.json'
import manifest from '../../public/manifest.json'
import { createZipBuffer } from '../../scripts/package.mjs'
import { extVersion } from './env'

describe('版本号一致性守卫', () => {
  it('package.json 与 public/manifest.json 的版本号必须完全一致', () => {
    expect(pkg.version).toBe(manifest.version)
  })

  it('版本号必须符合语义化版本格式 (x.y.z)', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
  })

  it('env.ts 中无扩展环境时的占位版本号需与 package.json 保持一致', () => {
    expect(extVersion()).toBe(pkg.version)
  })
})

describe('ZIP 压缩打包机制', () => {
  it('能够基于条目生成标准 ZIP 二进制结构', () => {
    const entries = [
      {
        name: 'manifest.json',
        data: Buffer.from(JSON.stringify({ manifest_version: 3, name: 'Panda Dock' })),
        mtime: new Date(),
      },
      {
        name: '_locales/zh_CN/messages.json',
        data: Buffer.from(JSON.stringify({ appName: { message: 'Panda Dock' } })),
        mtime: new Date(),
      },
    ]

    const zipBuffer = createZipBuffer(entries)
    expect(Buffer.isBuffer(zipBuffer)).toBe(true)
    expect(zipBuffer.length).toBeGreaterThan(0)

    // ZIP 文件开头必须是 Local File Header 签名 0x04034b50 (PK\x03\x04)
    expect(zipBuffer.readUInt32LE(0)).toBe(0x04034b50)

    // ZIP 文件末尾应包含 End of Central Directory 签名 0x06054b50 (PK\x05\x06)
    const eocdSignatureIndex = zipBuffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    expect(eocdSignatureIndex).toBeGreaterThan(0)
  })
})
