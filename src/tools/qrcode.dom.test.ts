// @vitest-environment happy-dom
import QRCode from 'qrcode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  decodeQrCodeFromBlob,
  DEFAULT_QR_COMPOSE,
  generateQrCodeBlob,
  generateQrCodeResult,
  presetToCompose,
} from './qrcode'

/**
 * qrcode.ts 的输出全靠 canvas 与 Image，happy-dom 两者都是空壳：
 * - getContext('2d') 返回 null → 用自建 fake ctx 记录所有绘制调用，把「画了什么」变成可断言事实；
 * - Image 不会真的加载 → 用桩在设置 src 后异步触发 onload/onerror，并带 naturalWidth/Height。
 * 不做快照、不真下载，只断言尺寸、方格数、路径分支与真实 jsQR 解码结果。
 */

const LOGO = 'data:image/png;base64,iVBORw0KGgo='

type FakeMethod = ReturnType<typeof vi.fn>

interface FakeCtx {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  imageSmoothingEnabled: boolean
  imageSmoothingQuality: ImageSmoothingQuality
  fillRect: FakeMethod
  beginPath: FakeMethod
  arc: FakeMethod
  arcTo: FakeMethod
  moveTo: FakeMethod
  closePath: FakeMethod
  rect: FakeMethod
  roundRect?: FakeMethod
  fill: FakeMethod
  stroke: FakeMethod
  clip: FakeMethod
  drawImage: FakeMethod
  fillText: FakeMethod
  measureText: FakeMethod
  save: FakeMethod
  restore: FakeMethod
  getImageData: FakeMethod
}

/** 建一个「记账用」的 2D 上下文；measureText 默认按字符数线性计宽，便于把截断结果算成确定值 */
function createFakeCtx(): FakeCtx {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    moveTo: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    save: vi.fn(),
    restore: vi.fn(),
    getImageData: vi.fn(),
  }
}

interface StubImageOptions {
  width?: number
  height?: number
  fail?: boolean
}

/** 替换全局 Image：设置 src 后异步回调，模拟真实加载时序 */
function stubImage(options: StubImageOptions = {}) {
  const { width = 64, height = 64, fail = false } = options
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    crossOrigin = ''
    naturalWidth = width
    naturalHeight = height
    width = width
    height = height
    set src(_value: string) {
      queueMicrotask(() => {
        if (fail) this.onerror?.()
        else this.onload?.()
      })
    }
  }
  vi.stubGlobal('Image', FakeImage)
}

/** 与源码同源的期望布局：模块数、整像素缩放、居中偏移与暗色方格数 */
function expectedLayout(text: string, targetWidth: number, margin: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const moduleCount = qr.modules.size
  const totalModules = moduleCount + margin * 2
  const scale = Math.max(1, Math.floor(targetWidth / totalModules))
  const offset = Math.round((targetWidth - moduleCount * scale) / 2)
  let dark = 0
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.modules.get(row, col)) dark += 1
    }
  }
  return { moduleCount, scale, offset, dark }
}

/**
 * 用真实 qrcode 点阵渲染出带 quiet zone 的黑白 RGBA 像素，
 * 交给 jsQR 时必须能还原原文——这是「解析」功能的真实回归，而不是 mock 之间的自说自话。
 */
function qrImageData(text: string, scale = 4, quiet = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const moduleCount = qr.modules.size
  const size = (moduleCount + quiet * 2) * scale
  const data = new Uint8ClampedArray(size * size * 4)
  data.fill(255)
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!qr.modules.get(row, col)) continue
      const x0 = (col + quiet) * scale
      const y0 = (row + quiet) * scale
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const index = ((y0 + dy) * size + (x0 + dx)) * 4
          data[index] = 0
          data[index + 1] = 0
          data[index + 2] = 0
          data[index + 3] = 255
        }
      }
    }
  }
  return { data, size }
}

let fakeCtx: FakeCtx
let getContextMock: FakeMethod

beforeEach(() => {
  fakeCtx = createFakeCtx()
  getContextMock = vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as FakeMethod
  getContextMock.mockImplementation(() => fakeCtx)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,UE5H')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('generateQrCodeResult 的画布尺寸与导出格式', () => {
  it('canvas.width 严格等于 targetWidth，无 label 时高度与宽度相同', async () => {
    const result = await generateQrCodeResult('PANDA', { targetWidth: 240 })

    expect(result.width).toBe(240)
    expect(result.height).toBe(240)
    expect(result.dataUrl.startsWith('data:image/png')).toBe(true)
  })

  it('有 label 时高度 = targetWidth + 按 240 基准缩放后的 labelHeight', async () => {
    // targetWidth=240 时 fontRatio=1，canvasFontSize=round(18)=18，labelHeight=round(18*2.4)=43
    const withLabel = await generateQrCodeResult('PANDA', { targetWidth: 240, label: '扫码查看' })
    expect(withLabel.height).toBe(240 + 43)

    fakeCtx.fillRect.mockClear()
    fakeCtx.fillText.mockClear()

    // 放大到 480 时字体与标签高度等比放大：canvasFontSize=36，labelHeight=round(86.4)=86
    const bigger = await generateQrCodeResult('PANDA', { targetWidth: 480, label: '扫码查看' })
    expect(bigger.height).toBe(480 + 86)
  })

  it('label 为 null / 空串 / 纯空白时不增加高度，也不绘制文本', async () => {
    for (const label of [null, '', '   ', '\t\n']) {
      fakeCtx.fillText.mockClear()
      const result = await generateQrCodeResult('PANDA', { targetWidth: 240, label })
      expect(result.height).toBe(240)
      expect(fakeCtx.fillText).not.toHaveBeenCalled()
    }
  })

  it('关闭了图像平滑：点阵方块保持硬边，不被灰化', async () => {
    await generateQrCodeResult('PANDA', { targetWidth: 240 })
    expect(fakeCtx.imageSmoothingEnabled).toBe(false)
    expect(fakeCtx.fillStyle).toBe('#000000')
  })
})

describe('点阵绘制：方格数、scale 与整像素对齐', () => {
  it('fillRect 次数 = 背景 1 次 + 暗色模块数，且每格边长恰为 scale', async () => {
    const layout = expectedLayout('PANDA', 480, 2)

    await generateQrCodeResult('PANDA', { targetWidth: 480, margin: 2 })

    const calls = fakeCtx.fillRect.mock.calls
    expect(calls).toHaveLength(layout.dark + 1)
    expect(calls[0]).toEqual([0, 0, 480, 480])
    for (const call of calls.slice(1)) {
      expect(call[2]).toBe(layout.scale)
      expect(call[3]).toBe(layout.scale)
    }
  })

  it('每个方格都落在 offset + 整数倍 scale 的物理像素上，且不超出点阵范围', async () => {
    const layout = expectedLayout('PANDA', 480, 2)

    await generateQrCodeResult('PANDA', { targetWidth: 480, margin: 2 })

    const contentEnd = layout.offset + layout.moduleCount * layout.scale
    for (const [x, y, w] of fakeCtx.fillRect.mock.calls.slice(1)) {
      expect((x - layout.offset) % layout.scale).toBe(0)
      expect((y - layout.offset) % layout.scale).toBe(0)
      expect(x).toBeGreaterThanOrEqual(layout.offset)
      expect(y).toBeGreaterThanOrEqual(layout.offset)
      expect(x + w).toBeLessThanOrEqual(contentEnd)
    }
  })

  it('margin 只改变 scale 与偏移，不改变画布导出尺寸', async () => {
    const tight = expectedLayout('PANDA', 480, 0)
    const loose = expectedLayout('PANDA', 480, 4)
    expect(tight.scale).not.toBe(loose.scale)
    expect(tight.offset).not.toBe(loose.offset)

    const first = await generateQrCodeResult('PANDA', { targetWidth: 480, margin: 0 })
    expect(first.width).toBe(480)
    const tightRects = fakeCtx.fillRect.mock.calls.slice(1)
    expect(tightRects[0][2]).toBe(tight.scale)

    fakeCtx.fillRect.mockClear()
    const second = await generateQrCodeResult('PANDA', { targetWidth: 480, margin: 4 })
    expect(second.width).toBe(480)
    const looseRects = fakeCtx.fillRect.mock.calls.slice(1)
    expect(looseRects[0][2]).toBe(loose.scale)
    expect(looseRects[0][2]).not.toBe(tightRects[0][2])
  })

  it('targetWidth 越大，scale 与画布宽度同步变大', async () => {
    const small = expectedLayout('PANDA', 240, 2)
    const large = expectedLayout('PANDA', 720, 2)
    expect(large.scale).toBeGreaterThan(small.scale)

    const smallResult = await generateQrCodeResult('PANDA', { targetWidth: 240 })
    expect(smallResult.width).toBe(240)
    expect(fakeCtx.fillRect.mock.calls[1][2]).toBe(small.scale)

    fakeCtx.fillRect.mockClear()
    const largeResult = await generateQrCodeResult('PANDA', { targetWidth: 720 })
    expect(largeResult.width).toBe(720)
    expect(fakeCtx.fillRect.mock.calls[1][2]).toBe(large.scale)
  })
})

describe('底部 label 的绘制与截断', () => {
  it('未超宽时原样绘制，并去掉首尾空白', async () => {
    await generateQrCodeResult('PANDA', { targetWidth: 240, label: '  扫码查看  ' })

    expect(fakeCtx.fillText).toHaveBeenCalledTimes(1)
    expect(fakeCtx.fillText.mock.calls[0][0]).toBe('扫码查看')
    // 垂直居中：标签基线落在点阵底边与画布底边之间的中点
    expect(fakeCtx.textAlign).toBe('center')
    expect(fakeCtx.textBaseline).toBe('middle')
  })

  it('超长时按 measureText 宽度逐字截断并补省略号（保留 20 字 + …）', async () => {
    const label = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

    await generateQrCodeResult('PANDA', { targetWidth: 240, label })

    // targetWidth=240 → maxTextWidth=216；measureText 按每字 10px 计
    expect(fakeCtx.fillText).toHaveBeenCalledTimes(1)
    expect(fakeCtx.fillText.mock.calls[0][0]).toBe(`${label.slice(0, 20)}…`)
  })
})

describe('中心 Logo 合成', () => {
  it('有 logoUrl 时强制 H 纠错，并绘制图片', async () => {
    stubImage()
    const createSpy = vi.spyOn(QRCode, 'create')

    await generateQrCodeResult('PANDA', { targetWidth: 240, logoUrl: LOGO })

    expect(createSpy).toHaveBeenCalledWith('PANDA', { errorCorrectionLevel: 'H' })
    expect(fakeCtx.drawImage).toHaveBeenCalledTimes(1)
    // 合成 Logo 时重新打开高质量平滑
    expect(fakeCtx.imageSmoothingEnabled).toBe(true)
    expect(fakeCtx.imageSmoothingQuality).toBe('high')
  })

  it('无 logoUrl 时使用传入的纠错等级（默认 M）且不绘制图片', async () => {
    const createSpy = vi.spyOn(QRCode, 'create')

    await generateQrCodeResult('PANDA', { targetWidth: 240 })
    expect(createSpy).toHaveBeenCalledWith('PANDA', { errorCorrectionLevel: 'M' })

    fakeCtx.drawImage.mockClear()
    await generateQrCodeResult('PANDA', { targetWidth: 240, errorCorrectionLevel: 'L' })
    expect(createSpy).toHaveBeenLastCalledWith('PANDA', { errorCorrectionLevel: 'L' })
    expect(fakeCtx.drawImage).not.toHaveBeenCalled()
  })

  it('logoShape=circle 用 arc 画保护垫与裁切蒙版', async () => {
    stubImage()
    await generateQrCodeResult('PANDA', {
      targetWidth: 240,
      logoUrl: LOGO,
      logoShape: 'circle',
    })

    expect(fakeCtx.arc).toHaveBeenCalledTimes(2)
    expect(fakeCtx.rect).not.toHaveBeenCalled()
    expect(fakeCtx.roundRect).not.toHaveBeenCalled()
    expect(fakeCtx.clip).toHaveBeenCalledTimes(1)
  })

  it('logoShape=square 用 rect 画保护垫与裁切蒙版', async () => {
    stubImage()
    await generateQrCodeResult('PANDA', {
      targetWidth: 240,
      logoUrl: LOGO,
      logoShape: 'square',
    })

    expect(fakeCtx.rect).toHaveBeenCalledTimes(2)
    expect(fakeCtx.arc).not.toHaveBeenCalled()
    expect(fakeCtx.roundRect).not.toHaveBeenCalled()
    expect(fakeCtx.clip).toHaveBeenCalledTimes(1)
  })

  it('logoMargin="none"（或 false）关闭保护垫留白与描边，底框与 Logo 尺寸严格重合', async () => {
    stubImage()
    await generateQrCodeResult('PANDA', {
      targetWidth: 240,
      logoUrl: LOGO,
      logoShape: 'square',
      logoMargin: 'none',
    })

    const logoSize = Math.round(240 * 0.22)
    const centerX = Math.round((240 - logoSize) / 2)

    // 两次 rect（一次清除二维码中心点阵的背景 fill，一次 Logo 裁切蒙版），参数必须完全一致且无 pad
    expect(fakeCtx.rect).toHaveBeenCalledTimes(2)
    expect(fakeCtx.rect).toHaveBeenNthCalledWith(1, centerX, centerX, logoSize, logoSize)
    expect(fakeCtx.rect).toHaveBeenNthCalledWith(2, centerX, centerX, logoSize, logoSize)
    // 明确不调用 stroke 绘制边框
    expect(fakeCtx.stroke).not.toHaveBeenCalled()
  })

  it('logoMargin="tight" 采用紧凑留白（0 < pad_tight < pad_standard），无杂色描边与阴影', async () => {
    stubImage()
    await generateQrCodeResult('PANDA', {
      targetWidth: 240,
      logoUrl: LOGO,
      logoShape: 'square',
      logoMargin: 'tight',
    })

    const logoSize = Math.round(240 * 0.22)
    const tightBoxSize = fakeCtx.rect.mock.calls[0][2] as number
    expect(tightBoxSize).toBeGreaterThan(logoSize)
    expect(fakeCtx.stroke).not.toHaveBeenCalled()

    // 对比 standard 模式，tight 的 boxSize 必须更小（留白更紧凑）
    fakeCtx.rect.mockClear()
    fakeCtx.stroke.mockClear()
    await generateQrCodeResult('PANDA', {
      targetWidth: 240,
      logoUrl: LOGO,
      logoShape: 'square',
      logoMargin: 'standard',
    })
    const standardBoxSize = fakeCtx.rect.mock.calls[0][2] as number
    expect(standardBoxSize).toBeGreaterThan(tightBoxSize)
    expect(fakeCtx.stroke).not.toHaveBeenCalled()
  })

  it('logoMargin="standard"（默认）保留标准留白，无杂色描边与阴影', async () => {
    stubImage()
    await generateQrCodeResult('PANDA', {
      targetWidth: 240,
      logoUrl: LOGO,
      logoShape: 'square',
    })

    const logoSize = Math.round(240 * 0.22)
    const centerX = Math.round((240 - logoSize) / 2)

    expect(fakeCtx.rect).toHaveBeenCalledTimes(2)
    // 第一次是保护垫（boxSize > logoSize，坐标往左上偏移 pad）
    const firstCallArgs = fakeCtx.rect.mock.calls[0]
    expect(firstCallArgs[2]).toBeGreaterThan(logoSize)
    expect(firstCallArgs[0]).toBeLessThan(centerX)
    // 第二次是 Logo 裁切蒙版（尺寸严格为 logoSize）
    expect(fakeCtx.rect).toHaveBeenNthCalledWith(2, centerX, centerX, logoSize, logoSize)
    // 彻底去除半透明描边，杜绝阴影感
    expect(fakeCtx.stroke).not.toHaveBeenCalled()
  })

  it('logoShape=rounded 优先使用 roundRect', async () => {
    stubImage()
    await generateQrCodeResult('PANDA', {
      targetWidth: 240,
      logoUrl: LOGO,
      logoShape: 'rounded',
    })

    expect(fakeCtx.roundRect).toHaveBeenCalledTimes(2)
    expect(fakeCtx.arc).not.toHaveBeenCalled()
    expect(fakeCtx.rect).not.toHaveBeenCalled()
  })

  it('roundRect 不可用时降级为 moveTo/arcTo/closePath 手绘圆角', async () => {
    stubImage()
    delete fakeCtx.roundRect

    await generateQrCodeResult('PANDA', {
      targetWidth: 240,
      logoUrl: LOGO,
      logoShape: 'rounded',
    })

    // pathRoundRect 被调用两次（保护垫 + Logo 蒙版），每次 1 moveTo + 4 arcTo + 1 closePath
    expect(fakeCtx.moveTo).toHaveBeenCalledTimes(2)
    expect(fakeCtx.arcTo).toHaveBeenCalledTimes(8)
    expect(fakeCtx.closePath).toHaveBeenCalledTimes(2)
  })

  it('宽度大于高度时按 cover 从左右居中裁剪，防止拉伸畸变', async () => {
    stubImage({ width: 80, height: 40 })
    await generateQrCodeResult('PANDA', { targetWidth: 240, logoUrl: LOGO })

    const args = fakeCtx.drawImage.mock.calls[0]
    expect(args[1]).toBe(20) // sx = (80-40)/2
    expect(args[2]).toBe(0) // sy
    expect(args[3]).toBe(40) // sSize = min(w,h)
    expect(args[4]).toBe(40)
  })

  it('高度大于宽度时按 cover 从上下居中裁剪', async () => {
    stubImage({ width: 40, height: 80 })
    await generateQrCodeResult('PANDA', { targetWidth: 240, logoUrl: LOGO })

    const args = fakeCtx.drawImage.mock.calls[0]
    expect(args[1]).toBe(0)
    expect(args[2]).toBe(20)
    expect(args[3]).toBe(40)
    expect(args[4]).toBe(40)
  })

  it('Logo 加载失败被 catch，点阵与导出不受影响', async () => {
    stubImage({ fail: true })
    const result = await generateQrCodeResult('PANDA', { targetWidth: 240, logoUrl: LOGO })

    expect(result.width).toBe(240)
    expect(result.height).toBe(240)
    expect(fakeCtx.drawImage).not.toHaveBeenCalled()
    // 点阵仍然绘制：背景 + 至少一个暗色模块
    expect(fakeCtx.fillRect.mock.calls.length).toBeGreaterThan(1)
  })
})

describe('canvas 上下文不可用时的可读报错', () => {
  it('generateQrCodeResult 抛出明确错误而不是空指针', async () => {
    getContextMock.mockReturnValue(null)
    await expect(generateQrCodeResult('PANDA')).rejects.toThrow('Canvas 2D context not available')
  })
})

describe('generateQrCodeBlob', () => {
  it('toBlob 回调拿到 Blob 时 resolve 该 Blob', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['png-bytes'], { type: 'image/png' }))
    })

    const blob = await generateQrCodeBlob('PANDA', { targetWidth: 240 })

    expect(blob.type).toBe('image/png')
    expect(await blob.text()).toBe('png-bytes')
  })

  it('toBlob 回调拿到 null 时 reject 可读错误', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(null)
    })

    await expect(generateQrCodeBlob('PANDA')).rejects.toThrow(
      'Failed to create PNG blob from canvas',
    )
  })
})

describe('decodeQrCodeFromBlob（真实 jsQR 解码）', () => {
  it('从点阵 RGBA 像素中还原原文，并释放临时 ObjectURL', async () => {
    const text = 'https://example.com/panda-dock'
    const { data, size } = qrImageData(text)
    stubImage({ width: size, height: size })
    fakeCtx.getImageData.mockImplementation(() => new ImageData(data, size, size))
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:qr-test')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const decoded = await decodeQrCodeFromBlob(new Blob(['fake-image']))

    expect(decoded).toBe(text)
    expect(fakeCtx.drawImage).toHaveBeenCalledTimes(1)
    expect(fakeCtx.getImageData).toHaveBeenCalledWith(0, 0, size, size)
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:qr-test')
  })

  it('纯色图里没有二维码时 reject No QR code found', async () => {
    const size = 120
    const blank = new Uint8ClampedArray(size * size * 4).fill(255)
    stubImage({ width: size, height: size })
    fakeCtx.getImageData.mockImplementation(() => new ImageData(blank, size, size))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:blank')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    await expect(decodeQrCodeFromBlob(new Blob(['white']))).rejects.toThrow(
      'No QR code found in image',
    )
  })

  it('图片加载失败时 reject Failed to load image，并释放临时 ObjectURL', async () => {
    stubImage({ fail: true })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:broken')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    await expect(decodeQrCodeFromBlob(new Blob(['broken']))).rejects.toThrow('Failed to load image')
    expect(revokeUrl).toHaveBeenCalledWith('blob:broken')
  })

  it('canvas 上下文不可用时 reject 可读错误', async () => {
    stubImage({ width: 24, height: 24 })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:no-ctx')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    getContextMock.mockReturnValue(null)

    await expect(decodeQrCodeFromBlob(new Blob(['x']))).rejects.toThrow(
      'Canvas 2D context not available',
    )
  })
})

describe('presetToCompose：把「保存的默认样式」映射成合成参数', () => {
  it('只覆盖预设声明过的字段，其余留给会话草稿 / 出厂值', () => {
    expect(presetToCompose({})).toEqual({})
    expect(presetToCompose({ margin: 4, resolution: 800 })).toEqual({ margin: 4, resolution: 800 })
  })

  it('ecLevel 同时写进「记住的原等级」，供移除外置 Logo 时回落', () => {
    expect(presetToCompose({ ecLevel: 'Q' })).toEqual({ ecLevel: 'Q', ecLevelBeforeLogo: 'Q' })
  })

  it('历史 boolean 版 logoMargin 归一化为 none / standard', () => {
    expect(presetToCompose({ logoMargin: false }).logoMargin).toBe('none')
    expect(presetToCompose({ logoMargin: true }).logoMargin).toBe('standard')
    expect(presetToCompose({ logoMargin: 'tight' }).logoMargin).toBe('tight')
  })

  it('映射结果不会夹带 label —— 底部说明文字属于内容，不归样式预设管', () => {
    const mapped = presetToCompose({ margin: 1 })
    expect(Object.keys(mapped)).not.toContain('label')
    expect(DEFAULT_QR_COMPOSE.label).toBe('')
  })
})
