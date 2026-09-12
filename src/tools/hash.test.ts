import { describe, expect, it } from 'vitest'

import {
  bytesToHex,
  computeFileHash,
  computeTextHash,
  HASH_FILE_MAX_BYTES,
  HASH_FILE_MD5_SKIP_BYTES,
  matchChecksum,
  md5,
  md5Raw,
} from './hash'

/** 期望值由 Node 内置 crypto 独立生成（非取自被测实现），用于交叉验证 */
const PANGRAM = 'The quick brown fox jumps over the lazy dog'

describe('md5', () => {
  it('空串与 ASCII 标准向量', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5(PANGRAM)).toBe('9e107d9d372bb6826bd81d3542a419d6')
  })

  it('UTF-8 多字节文本向量', () => {
    expect(md5('你好')).toBe('7eca689f0d3389d9dea66ae112e5cfd7')
  })

  it('字符串入参与等价 UTF-8 字节数组结果一致', () => {
    expect(md5(new TextEncoder().encode(PANGRAM))).toBe(md5(PANGRAM))
  })

  it('md5Raw 固定输出 16 字节', () => {
    expect(md5Raw(new TextEncoder().encode('abc'))).toHaveLength(16)
  })
})

describe('bytesToHex', () => {
  it('小写并逐个补零', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff')
    expect(bytesToHex(new Uint8Array([]))).toBe('')
  })
})

describe('computeTextHash', () => {
  it('四种算法的标准向量', async () => {
    await expect(computeTextHash('abc')).resolves.toEqual({
      md5: '900150983cd24fb0d6963f7d28e17f72',
      sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      sha512:
        'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    })
  })

  it('空串向量', async () => {
    const res = await computeTextHash('')
    expect(res.md5).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(res.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('uppercase 选项输出大写 Hex', async () => {
    const res = await computeTextHash('abc', { uppercase: true })
    expect(res.md5).toBe('900150983CD24FB0D6963F7D28E17F72')
    expect(res.sha256).toBe('BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD')
  })

  it('HMAC 模式与 Node crypto 参考值一致', async () => {
    const hmacMd5 = await computeTextHash(PANGRAM, { hmacKey: 'key' })
    expect(hmacMd5.md5).toBe('80070713463e7749b90c2dc24911e275')

    const hmacSha = await computeTextHash('abc', { hmacKey: 'key' })
    expect(hmacSha.sha256).toBe('9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab')
  })

  it('hmacKey 为空白时退回普通哈希', async () => {
    const res = await computeTextHash('abc', { hmacKey: '   ' })
    expect(res.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('matchChecksum', () => {
  const hashes = {
    md5: 'd41d8cd98f00b204e9800998ecf8427e',
    sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    sha512: 'ddaf35a193617abacc417349ae204131',
  }

  it('忽略大小写与首尾空白后命中并指明算法', () => {
    expect(matchChecksum('  D41D8CD98F00B204E9800998ECF8427E  ', hashes)).toMatchObject({
      matched: true,
      algorithm: 'MD5',
    })
    expect(matchChecksum(hashes.sha256.toUpperCase(), hashes)).toMatchObject({
      matched: true,
      algorithm: 'SHA-256',
    })
  })

  it('长度正确但不一致时 matched 为 false', () => {
    expect(matchChecksum('0'.repeat(64), hashes).matched).toBe(false)
  })

  it('空期望值或哈希结果缺失时 matched 为 false', () => {
    expect(matchChecksum('', hashes).matched).toBe(false)
    expect(matchChecksum('abc', null).matched).toBe(false)
  })

  it('跳过的空哈希（超限未算 MD5）不会被误判为命中', () => {
    const empty = { md5: '', sha1: '', sha256: '', sha512: '' }
    expect(matchChecksum('900150983cd24fb0d6963f7d28e17f72', empty).matched).toBe(false)
    expect(matchChecksum('d41d8cd98f00b204e9800998ecf8427e', empty).matched).toBe(false)
  })
})

describe('computeFileHash：体积守卫与主线程保护', () => {
  const ABC = new TextEncoder().encode('abc')
  const ABC_VECTORS = {
    md5: '900150983cd24fb0d6963f7d28e17f72',
    sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    sha512:
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  }

  /** 用 defineProperty 伪造 size：既能测到守卫分支，又不必在测试里真的分配几百 MB */
  const makeFile = (data: Uint8Array, name: string, fakeSize?: number) => {
    const file = new File([data], name)
    if (fakeSize !== undefined) Object.defineProperty(file, 'size', { value: fakeSize })
    return file
  }

  it('普通文件四种哈希与标准向量一致', async () => {
    const outcome = await computeFileHash(makeFile(ABC, 'abc.txt'))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.md5Skipped).toBe(false)
    expect(outcome.hashes).toEqual(ABC_VECTORS)
  })

  it('uppercase 选项同样作用于文件哈希', async () => {
    const outcome = await computeFileHash(makeFile(ABC, 'abc.txt'), { uppercase: true })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hashes.sha256).toBe(ABC_VECTORS.sha256.toUpperCase())
  })

  it('超过硬上限时直接拒绝，且不读取文件内容（3 字节文件伪造出超大 size 也能触发）', async () => {
    const size = HASH_FILE_MAX_BYTES + 1
    const outcome = await computeFileHash(makeFile(ABC, 'huge.iso', size))
    expect(outcome).toEqual({
      ok: false,
      reason: 'too-large',
      sizeBytes: size,
      maxBytes: HASH_FILE_MAX_BYTES,
    })
  })

  it('介于两档阈值之间时跳过纯 JS 的 MD5，但原生 SHA 照常计算', async () => {
    const size = HASH_FILE_MD5_SKIP_BYTES + 1
    const outcome = await computeFileHash(makeFile(ABC, 'big.bin', size))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.md5Skipped).toBe(true)
    expect(outcome.hashes.md5).toBe('')
    // 内容仍是那 3 字节，因此 SHA 与标准向量一致：说明「跳过」只由体积决定，哈希只由内容决定
    expect(outcome.hashes.sha256).toBe(ABC_VECTORS.sha256)
    expect(outcome.hashes.sha512).toBe(ABC_VECTORS.sha512)
  })

  it('恰好等于阈值时不触发任何跳过', async () => {
    const outcome = await computeFileHash(makeFile(ABC, 'edge.bin', HASH_FILE_MD5_SKIP_BYTES))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.md5Skipped).toBe(false)
    expect(outcome.hashes.md5).toBe(ABC_VECTORS.md5)
  })

  it('阈值常量关系合理（跳过阈值必须小于硬上限）', () => {
    expect(HASH_FILE_MD5_SKIP_BYTES).toBeLessThan(HASH_FILE_MAX_BYTES)
    expect(HASH_FILE_MD5_SKIP_BYTES).toBeGreaterThan(0)
  })
})
