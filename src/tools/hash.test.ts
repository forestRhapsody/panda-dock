import { afterEach, describe, expect, it, vi } from 'vitest'

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
import type { HashResult } from './hash'

/**
 * 全部期望值均由 Node 内置 crypto（createHash / createHmac）离线生成后固化，
 * 不复用被测实现的计算结果，属于真正的独立参照（known-answer test）。
 */

/** RFC 1321 附录 A.5 给出的 md5 标准测试向量（含两个经典长串） */
const RFC1321_MD5: [string, string][] = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    'd174ab98d277d9f5a5611c2c9f419d9f',
  ],
  [
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
    '57edf4a22be3c955ac49da2e2107b67a',
  ],
]

const PANGRAM = 'The quick brown fox jumps over the lazy dog'

/**
 * 直接命中 MD5 padding 边界：长度 % 64 落在 55/56/63/64/65/119/120 时，
 * 补齐块的数量会切换（55→补 1 块，56→补 2 块，120→补 2 块），是长度分支最容易写错的位置。
 */
const PADDING_BOUNDARY_VECTORS: [number, HashResult][] = [
  [
    55,
    {
      md5: 'ef1772b6dff9a122358552954ad0df65',
      sha1: 'c1c8bbdc22796e28c0e15163d20899b65621d65a',
      sha256: '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
      sha512:
        'b0220c772cbf6c1822e2cb38a437d0e1d58772417a4bbb21c961364f8b6143e05aa6316dca8d1d7b19e16448419076395f6086cb55101fbd6d5497b148e1745f',
    },
  ],
  [
    56,
    {
      md5: '3b0c8ac703f828b04c6c197006d17218',
      sha1: 'c2db330f6083854c99d4b5bfb6e8f29f201be699',
      sha256: 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
      sha512:
        '962b64aae357d2a4fee3ded8b539bdc9d325081822b0bfc55583133aab44f18bafe11d72a7ae16c79ce2ba620ae2242d5144809161945f1367f41b3972e26e04',
    },
  ],
  [
    63,
    {
      md5: 'b06521f39153d618550606be297466d5',
      sha1: '03f09f5b158a7a8cdad920bddc29b81c18a551f5',
      sha256: '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34',
      sha512:
        'c1b0f5c6d3b03dfe4a2602e67242f54e344090b66e01100a469b129f583f016c7e27dddeaa438393dcc7ec54b0b57c9ba7af007f9b56db5f6fb677d972a31362',
    },
  ],
  [
    64,
    {
      md5: '014842d480b571495a4a0363793f7367',
      sha1: '0098ba824b5c16427bd7a1122a5a442a25ec644d',
      sha256: 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
      sha512:
        '01d35c10c6c38c2dcf48f7eebb3235fb5ad74a65ec4cd016e2354c637a8fb49b695ef3c1d6f7ae4cd74d78cc9c9bcac9d4f23a73019998a7f73038a5c9b2dbde',
    },
  ],
  [
    65,
    {
      md5: 'c743a45e0d2e6a95cb859adae0248435',
      sha1: '11655326c708d70319be2610e8a57d9a5b959d3b',
      sha256: '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0',
      sha512:
        'b83086cd8494e55708ad7ecd82dfb4bca1bda61ecbb7caf0c68967902e709345e5d8305eb7ac0d588afc6cbb75161aa9c8c7e0ea986bd833dafe5e1ccd37345a',
    },
  ],
  [
    119,
    {
      md5: '8a7bd0732ed6a28ce75f6dabc90e1613',
      sha1: 'ee971065aaa017e0632a8ca6c77bb3bf8b1dfc56',
      sha256: '31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb',
      sha512:
        '130396a75cb483f2eee8c56d8a668bb3d2641f5243212c0bee2bd33da096ad9eb8179fe18f9eaacf76e09fae9de4c3f14ba13341e345be05bf76c182cc3468cb',
    },
  ],
  [
    120,
    {
      md5: '5f61c0ccad4cac44c75ff505e1f1e537',
      sha1: 'f34c1488385346a55709ba056ddd08280dd4c6d6',
      sha256: '2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c',
      sha512:
        'f241de612b01aa2fa3cf01531d2a8e5e17fc761dfd48a704a834a47f57d6eade7804ecc39be42fdef16ec6adeaf7c01c2fd0c4cc97d3860907cfa4a3b36d0c05',
    },
  ],
]

const ABC_VECTORS: HashResult = {
  md5: '900150983cd24fb0d6963f7d28e17f72',
  sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  sha512:
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
}

const ABC_BYTES = new TextEncoder().encode('abc')

describe('md5：RFC 1321 标准向量', () => {
  it.each(RFC1321_MD5)('md5(%j) 命中已知向量', (text, expected) => {
    expect(md5(text)).toBe(expected)
  })

  it('长度参数不影响结果：字符串与等价 UTF-8 字节数组、字节数组切片一致', () => {
    expect(md5(ABC_BYTES)).toBe(ABC_VECTORS.md5)
    // subarray 带 byteOffset：实现内部先复制到新缓冲区，必须仍然只哈希切片本身
    const wrapped = new Uint8Array([0xff, 0x61, 0x62, 0x63, 0xff]).subarray(1, 4)
    expect([...wrapped]).toEqual([0x61, 0x62, 0x63])
    expect(md5(wrapped)).toBe(ABC_VECTORS.md5)
  })

  it('md5Raw 固定返回 16 字节，且与 hex 输出互为同一结果', () => {
    const raw = md5Raw(ABC_BYTES)
    expect(raw).toBeInstanceOf(Uint8Array)
    expect(raw).toHaveLength(16)
    expect(bytesToHex(raw)).toBe(ABC_VECTORS.md5)
  })

  it('md5Raw 对空输入也返回 16 字节（padding 分支 originalLength=0）', () => {
    expect(bytesToHex(md5Raw(new Uint8Array(0)))).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })
})

describe('md5：padding 长度边界与超长输入', () => {
  it.each(PADDING_BOUNDARY_VECTORS)('长度 %i 的 "a"*n 四种算法全部命中', (length, expected) => {
    expect(md5('a'.repeat(length))).toBe(expected.md5)
  })

  it.each(PADDING_BOUNDARY_VECTORS)(
    'computeTextHash 在长度 %i 上与向量一致（SHA 侧同样跨过补齐块）',
    async (length, expected) => {
      // md5 已单独断言，这里重点验证 Web Crypto 的 SHA 系列
      const res = await computeTextHash('a'.repeat(length))
      expect({ sha1: res.sha1, sha256: res.sha256, sha512: res.sha512 }).toEqual({
        sha1: expected.sha1,
        sha256: expected.sha256,
        sha512: expected.sha512,
      })
    },
  )

  it('RFC 1321 的一百万个 "a" 超长向量（验证 64 位长度累加与多块循环）', async () => {
    const million = 'a'.repeat(1000000)
    const res = await computeTextHash(million)
    expect(res).toEqual({
      md5: '7707d6ae4e027c70eea2a935c2296f21',
      sha1: '34aa973cd4c4daa4f61eeb2bdbad27316534016f',
      sha256: 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
      sha512:
        'e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b',
    })
  })
})

describe('md5 / computeTextHash：UTF-8、Unicode 与 emoji', () => {
  // 中文是多字节、emoji 是代理对（UTF-16 长度 ≠ UTF-8 字节数）、é + combining 是组合字符，
  // 三者共同保证实现走的是 TextEncoder 的 UTF-8 字节而非 UTF-16 码元
  const cases: [string, string, string, string][] = [
    [
      '你好',
      '7eca689f0d3389d9dea66ae112e5cfd7',
      '670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e',
      '5232181bc0d9888f5c9746e410b4740eb461706ba5dacfbc93587cecfc8d068bac7737e92870d6745b11a25e9cd78b55f4ffc706f73cfcae5345f1b53fb8f6b5',
    ],
    [
      '😀',
      '2a02eac39d716a70ecf37579185927b6',
      'f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9',
      '9b1ce8b6649e678e1cb7bca85afeaae750add5cfb0668d25ebba5e7f0038f1b6bdcc4bacd909049e752be2a3a3c0158c0f2bb5a33d8101b2ed5d74a66ece2425',
    ],
    [
      '中文😀é\u0301',
      '65943c4edbe3a573a5a3d4668b6d5e6c',
      '56c492a5cbe839e5565668fa07ceff0fee8d7d181de7fa9fcc498963dcdd3776',
      'c96345695bcbceed96a625d71753e4914e16507565a8b1128512b1c02c2c5eb998d9cff5d9bfc0170f17eff87d2876663da0eb4e15522a71ddb03eb32ce8e074',
    ],
  ]

  it.each(cases)('%j 的 MD5 命中 UTF-8 向量', (text, md5Hex) => {
    expect(md5(text)).toBe(md5Hex)
  })

  it.each(cases)('%j 的 SHA-256 命中 UTF-8 向量', async (text, _md5Hex, sha256Hex) => {
    expect((await computeTextHash(text)).sha256).toBe(sha256Hex)
  })

  it('中英混排与纯空白字符同样参与哈希（不 trim）', async () => {
    const padded = await computeTextHash(' abc ')
    expect(padded.sha256).not.toBe(ABC_VECTORS.sha256)
    expect((await computeTextHash('\tabc\n')).sha256).not.toBe(ABC_VECTORS.sha256)
    // 只有真正相同的字节序列才会得到相同结果
    expect((await computeTextHash(' abc ')).sha256).toBe((await computeTextHash(' abc ')).sha256)
  })
})

describe('bytesToHex：输入形态与逐字节补零', () => {
  it('Uint8Array 小写输出并逐字节补零', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff')
    expect(bytesToHex(new Uint8Array([]))).toBe('')
  })

  it('接受 ArrayBuffer（与等值 Uint8Array 输出一致）', () => {
    const u8 = new Uint8Array([1, 2, 16, 254])
    expect(bytesToHex(u8.buffer)).toBe('010210fe')
    expect(bytesToHex(u8.buffer)).toBe(bytesToHex(u8))
  })

  it('全字节表 0..255 输出 512 位定长小写 hex', () => {
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i++) all[i] = i
    const hex = bytesToHex(all)
    expect(hex).toHaveLength(512)
    expect(hex.slice(0, 8)).toBe('00010203')
    expect(hex.slice(-8)).toBe('fcfdfeff')
    expect(hex).toMatch(/^[0-9a-f]+$/)
  })

  it('不消费/不修改传入字节数组', () => {
    const u8 = new Uint8Array([9, 9, 9])
    bytesToHex(u8)
    expect([...u8]).toEqual([9, 9, 9])
  })
})

describe('computeTextHash：默认格式与选项', () => {
  it('默认返回小写 hex（四种算法长度分别为 32/40/64/128）', async () => {
    const res = await computeTextHash('abc')
    expect(res).toEqual(ABC_VECTORS)
    for (const value of Object.values(res)) {
      expect(value).toMatch(/^[0-9a-f]+$/)
    }
    expect([res.md5.length, res.sha1.length, res.sha256.length, res.sha512.length]).toEqual([
      32, 40, 64, 128,
    ])
  })

  it('空串向量', async () => {
    await expect(computeTextHash('')).resolves.toEqual({
      md5: 'd41d8cd98f00b204e9800998ecf8427e',
      sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sha512:
        'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    })
  })

  it('uppercase 选项只改大小写、不改数值', async () => {
    const lower = await computeTextHash(PANGRAM)
    const upper = await computeTextHash(PANGRAM, { uppercase: true })
    expect(upper).toEqual({
      md5: lower.md5.toUpperCase(),
      sha1: lower.sha1.toUpperCase(),
      sha256: lower.sha256.toUpperCase(),
      sha512: lower.sha512.toUpperCase(),
    })
    expect(upper.md5).toBe('9E107D9D372BB6826BD81D3542A419D6')
  })

  it('uppercase: false 显式传入时保持小写（选项为假值分支）', async () => {
    const res = await computeTextHash('abc', { uppercase: false })
    expect(res).toEqual(ABC_VECTORS)
  })

  it('options 省略 / 传空对象结果完全一致', async () => {
    const none = await computeTextHash('abc')
    const empty = await computeTextHash('abc', {})
    expect(empty).toEqual(none)
  })
})

describe('computeTextHash：HMAC 加盐', () => {
  it('HMAC-MD5/SHA-1/SHA-256/SHA-512 四种算法命中独立参照值', async () => {
    await expect(computeTextHash(PANGRAM, { hmacKey: 'key' })).resolves.toEqual({
      md5: '80070713463e7749b90c2dc24911e275',
      sha1: 'de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9',
      sha256: 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
      sha512:
        'b42af09057bac1e2d41708e48a902e09b5ff7f12ab428a4fe86653c73dd248fb82f948a549f7b791a5b41915ee4d1ec3935357e4e2317250d0372afa2ebeeb3a',
    })
  })

  it('空消息的 HMAC 仍带盐（不是无盐空串向量）', async () => {
    const res = await computeTextHash('', { hmacKey: 'key' })
    expect(res.sha256).toBe('5d5d139563c95b5967b9bd9a8c9b233a9dedb45072794cd232dc1b74832607d0')
    expect(res.md5).toBe('63530468a04e386459855da0063b6596')
  })

  it('超过 64 字节的长密钥走「先哈希再当密钥」的分支', async () => {
    // hmacMd5 内 key.length > 64 时会先 md5Raw(key)，Web Crypto 侧也由平台自行压缩
    const res = await computeTextHash('abc', { hmacKey: 'k'.repeat(80) })
    expect(res.md5).toBe('f6adea3fb984f72a9f554259f0c5233b')
    expect(res.sha256).toBe('3bf9d915e647129654188e1d6eae2ff4025f47eddc4a2f8c6b3c490dcb02e3b8')
  })

  it('Unicode / emoji 密钥与消息按 UTF-8 字节参与 HMAC', async () => {
    const res = await computeTextHash('消息😀', { hmacKey: '密🔑' })
    expect(res.md5).toBe('efa239b8089f0d45e555f22f6e4ffa25')
    expect(res.sha1).toBe('16605ff1799498679d58dff933678439acaee72b')
    expect(res.sha256).toBe('69d3d29fe700f65a4d196c12cf084b55390c838ef9a2560492d169edbdcb63b3')
    expect(res.sha512).toBe(
      '1184b9bfab9313c151068ebcd4501a8bb754e8f89a9eac6f054723a6feb8808a1798ae0565dc81163418452c44f938e259cd9fdd601191ff1c3d7a41d70267ef',
    )
  })

  it('hmacKey 首尾空白会被 trim（前后空格不参与密钥）', async () => {
    const trimmed = await computeTextHash('abc', { hmacKey: '  key\t' })
    const plain = await computeTextHash('abc', { hmacKey: 'key' })
    expect(trimmed).toEqual(plain)
  })

  it('hmacKey 为纯空白或空串时退回无盐哈希', async () => {
    expect(await computeTextHash('abc', { hmacKey: '   ' })).toEqual(ABC_VECTORS)
    expect(await computeTextHash('abc', { hmacKey: '' })).toEqual(ABC_VECTORS)
    expect(await computeTextHash('abc', { hmacKey: '\n\t ' })).toEqual(ABC_VECTORS)
  })

  it('HMAC 与 uppercase 可叠加', async () => {
    const res = await computeTextHash('abc', { hmacKey: 'key', uppercase: true })
    expect(res.sha256).toBe('9C196E32DC0175F86F4B1CB89289D6619DE6BEE699E4C378E68309ED97A1A6AB')
    expect(res.md5).toBe('D2FE98063F876B03193AFB49B4979591')
  })
})

describe('computeTextHash：底层失败时向上抛错（不静默降级）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('crypto.subtle.digest 失败时 Promise reject 原始错误', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('digest unavailable'))
    await expect(computeTextHash('abc')).rejects.toThrow('digest unavailable')
  })
})

describe('matchChecksum：校验和智能比对', () => {
  const hashes: HashResult = {
    md5: 'd41d8cd98f00b204e9800998ecf8427e',
    sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    sha512: 'ddaf35a193617abacc417349ae204131',
  }

  it.each([
    ['MD5', hashes.md5],
    ['SHA-1', hashes.sha1],
    ['SHA-256', hashes.sha256],
    ['SHA-512', hashes.sha512],
  ])('命中的值会回报对应算法 %s', (algorithm, value) => {
    expect(matchChecksum(value, hashes)).toEqual({ matched: true, algorithm, expected: value })
  })

  it('忽略首尾空白（含制表/换行）与大小写，expected 归一为小写', () => {
    expect(matchChecksum('  D41D8CD98F00B204E9800998ECF8427E  ', hashes)).toEqual({
      matched: true,
      algorithm: 'MD5',
      expected: hashes.md5,
    })
    expect(
      matchChecksum(
        '\n\tBA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD\r\n',
        hashes,
      ),
    ).toEqual({ matched: true, algorithm: 'SHA-256', expected: hashes.sha256 })
  })

  it('长度正确但不一致时 matched 为 false，并回传归一化后的期望值', () => {
    expect(matchChecksum('  ' + '0'.repeat(64) + '  ', hashes)).toEqual({
      matched: false,
      expected: '0'.repeat(64),
    })
  })

  it('前缀相同但更短的期望值不会误判命中', () => {
    expect(matchChecksum(hashes.md5.slice(0, 30), hashes).matched).toBe(false)
    expect(matchChecksum(hashes.sha1 + 'x', hashes).matched).toBe(false)
  })

  it('空期望值 / 纯空白：matched=false 且 expected 为空串', () => {
    expect(matchChecksum('', hashes)).toEqual({ matched: false, expected: '' })
    expect(matchChecksum('   \n\t', hashes)).toEqual({ matched: false, expected: '' })
  })

  it('hashes 为 null：matched=false，且 expected 回传空串（不回传输入）', () => {
    expect(matchChecksum('abc', null)).toEqual({ matched: false, expected: '' })
  })

  it('跳过的空哈希（超限未算 MD5）不参与比对，但其余算法照常命中', () => {
    const partial: HashResult = {
      md5: '',
      sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
      sha256: '',
      sha512: '',
    }
    expect(matchChecksum('a9993e364706816aba3e25717850c26c9cd0d89d', partial)).toEqual({
      matched: true,
      algorithm: 'SHA-1',
      expected: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    })
    expect(matchChecksum('', partial).matched).toBe(false)
    expect(matchChecksum('   ', partial).matched).toBe(false)
  })

  it('全空哈希时任何期望值都不命中（避免空串互相相等）', () => {
    const empty: HashResult = { md5: '', sha1: '', sha256: '', sha512: '' }
    expect(matchChecksum('', empty).matched).toBe(false)
    expect(matchChecksum('d41d8cd98f00b204e9800998ecf8427e', empty).matched).toBe(false)
  })
})

describe('computeFileHash：文件体积守卫与主线程保护', () => {
  /** 用 defineProperty 伪造 size：既能测到守卫分支，又不必在测试里真的分配几百 MB */
  const makeFile = (data: Uint8Array, name: string, fakeSize?: number) => {
    const file = new File([data], name)
    if (fakeSize !== undefined) Object.defineProperty(file, 'size', { value: fakeSize })
    return file
  }

  it('普通文件四种哈希与标准向量一致', async () => {
    const outcome = await computeFileHash(makeFile(ABC_BYTES, 'abc.txt'))
    expect(outcome).toEqual({ ok: true, md5Skipped: false, hashes: ABC_VECTORS })
  })

  it('空文件命中空串向量（arrayBuffer 长度为 0 的边界）', async () => {
    const outcome = await computeFileHash(makeFile(new Uint8Array(0), 'empty.txt'))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.md5Skipped).toBe(false)
    expect(outcome.hashes.md5).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(outcome.hashes.sha256).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('未命名 / 无扩展名文件不影响内容哈希', async () => {
    const outcome = await computeFileHash(makeFile(ABC_BYTES, ''))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hashes).toEqual(ABC_VECTORS)
  })

  it('uppercase 选项同样作用于文件哈希', async () => {
    const outcome = await computeFileHash(makeFile(ABC_BYTES, 'abc.txt'), { uppercase: true })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hashes).toEqual({
      md5: ABC_VECTORS.md5.toUpperCase(),
      sha1: ABC_VECTORS.sha1.toUpperCase(),
      sha256: ABC_VECTORS.sha256.toUpperCase(),
      sha512: ABC_VECTORS.sha512.toUpperCase(),
    })
  })

  it('恰好等于硬上限仍可计算（守卫条件是严格大于）', async () => {
    const outcome = await computeFileHash(makeFile(ABC_BYTES, 'edge.bin', HASH_FILE_MAX_BYTES))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hashes.sha256).toBe(ABC_VECTORS.sha256)
  })

  it('超过硬上限时直接拒绝，且不读取文件内容（3 字节文件伪造出超大 size 也能触发）', async () => {
    const size = HASH_FILE_MAX_BYTES + 1
    const outcome = await computeFileHash(makeFile(ABC_BYTES, 'huge.iso', size))
    expect(outcome).toEqual({
      ok: false,
      reason: 'too-large',
      sizeBytes: size,
      maxBytes: HASH_FILE_MAX_BYTES,
    })
  })

  it('跳过阈值前一字节仍计算 MD5（> 才是跳过条件）', async () => {
    const outcome = await computeFileHash(
      makeFile(ABC_BYTES, 'near.bin', HASH_FILE_MD5_SKIP_BYTES - 1),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.md5Skipped).toBe(false)
    expect(outcome.hashes.md5).toBe(ABC_VECTORS.md5)
  })

  it('介于两档阈值之间时跳过纯 JS 的 MD5，但原生 SHA 照常计算', async () => {
    const size = HASH_FILE_MD5_SKIP_BYTES + 1
    const outcome = await computeFileHash(makeFile(ABC_BYTES, 'big.bin', size))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.md5Skipped).toBe(true)
    expect(outcome.hashes.md5).toBe('')
    // 内容仍是那 3 字节，因此 SHA 与标准向量一致：说明「跳过」只由体积决定，哈希只由内容决定
    expect(outcome.hashes.sha256).toBe(ABC_VECTORS.sha256)
    expect(outcome.hashes.sha512).toBe(ABC_VECTORS.sha512)
  })

  it('跳过 MD5 时 uppercase 只作用在真实计算出的 SHA 上，空 MD5 保持空串', async () => {
    const outcome = await computeFileHash(
      makeFile(ABC_BYTES, 'big.bin', HASH_FILE_MD5_SKIP_BYTES + 1),
      {
        uppercase: true,
      },
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hashes.md5).toBe('')
    expect(outcome.hashes.sha1).toBe(ABC_VECTORS.sha1.toUpperCase())
  })

  it('阈值常量关系合理（跳过阈值必须小于硬上限）', () => {
    expect(HASH_FILE_MD5_SKIP_BYTES).toBeLessThan(HASH_FILE_MAX_BYTES)
    expect(HASH_FILE_MD5_SKIP_BYTES).toBeGreaterThan(0)
    expect(HASH_FILE_MAX_BYTES).toBe(256 * 1024 * 1024)
    expect(HASH_FILE_MD5_SKIP_BYTES).toBe(32 * 1024 * 1024)
  })

  it('文件读取失败时向上抛错（当前实现没有把 arrayBuffer 失败转为 ok:false）', async () => {
    const file = makeFile(ABC_BYTES, 'broken.bin')
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new Error('read failed')),
    })
    await expect(computeFileHash(file)).rejects.toThrow('read failed')
  })
})
