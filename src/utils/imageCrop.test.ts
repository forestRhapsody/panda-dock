// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { clampCropOffset, computeCropParams, cropAndCompressBallImage } from './imageCrop'

describe('clampCropOffset', () => {
  it('限制偏移范围，确保图片始终填满裁剪框不露白', () => {
    // 视口 260，裁剪框 200，偏移 30
    const cropOffset = 30
    const cropSize = 200
    const baseScale = 1
    const imgW = 400
    const imgH = 300

    // 1x 缩放下，renderW=400, renderH=300
    // minX = 30 + 200 - 400 = -170, maxX = 30
    // minY = 30 + 200 - 300 = -70, maxY = 30
    expect(clampCropOffset(50, 50, 1, imgW, imgH, cropOffset, cropSize, baseScale)).toEqual({
      x: 30,
      y: 30,
    })
    expect(clampCropOffset(-200, -100, 1, imgW, imgH, cropOffset, cropSize, baseScale)).toEqual({
      x: -170,
      y: -70,
    })
    expect(clampCropOffset(-50, -20, 1, imgW, imgH, cropOffset, cropSize, baseScale)).toEqual({
      x: -50,
      y: -20,
    })
  })

  it('放大时允许更大范围的拖拽', () => {
    const cropOffset = 30
    const cropSize = 200
    const baseScale = 1
    const imgW = 200
    const imgH = 200
    // 2x 缩放下，renderW=400, renderH=400
    // minX = -170, maxX = 30
    expect(clampCropOffset(-150, -150, 2, imgW, imgH, cropOffset, cropSize, baseScale)).toEqual({
      x: -150,
      y: -150,
    })
  })
})

describe('computeCropParams', () => {
  it('正确换算原图坐标与截取尺寸', () => {
    const cropOffset = 30
    const cropSize = 200
    const baseScale = 0.5
    const zoom = 1
    // scaleFactor = 0.5
    // offset = { x: 30, y: 30 }
    // cropX = (30 - 30) / 0.5 = 0
    // cropY = (30 - 30) / 0.5 = 0
    // size = 200 / 0.5 = 400
    const params = computeCropParams({ x: 30, y: 30 }, zoom, baseScale, cropOffset, cropSize)
    expect(params).toEqual({ x: 0, y: 0, size: 400 })
  })

  it('偏移与缩放时精确换算原图裁剪坐标', () => {
    const cropOffset = 30
    const cropSize = 200
    const baseScale = 1
    const zoom = 2
    // scaleFactor = 2
    // offset = { x: -10, y: -20 }
    // cropX = (30 - (-10)) / 2 = 20
    // cropY = (30 - (-20)) / 2 = 25
    // size = 200 / 2 = 100
    const params = computeCropParams({ x: -10, y: -20 }, zoom, baseScale, cropOffset, cropSize)
    expect(params).toEqual({ x: 20, y: 25, size: 100 })
  })
})

describe('cropAndCompressBallImage', () => {
  it('canvas 上下文不可用时返回 null', () => {
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: () => null,
    } as unknown as HTMLElement)

    const fakeImg = {} as CanvasImageSource
    const res = cropAndCompressBallImage(fakeImg, { x: 0, y: 0, size: 100 })
    expect(res).toBeNull()
    vi.restoreAllMocks()
  })

  it('正常情况下首选最高阶尺寸导出 PNG', () => {
    const fakeCtx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      drawImage: vi.fn(),
    }
    const drawnSizes: number[] = []
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') {
        const c = {
          width: 0,
          height: 0,
          getContext: () => fakeCtx,
          toDataURL: (type: string) => {
            drawnSizes.push(c.width)
            return `data:${type};base64,mock-data`
          },
        }
        return c as unknown as HTMLElement
      }
      return document.createElement(tag)
    })

    const fakeImg = {} as CanvasImageSource
    const res = cropAndCompressBallImage(fakeImg, { x: 10, y: 20, size: 80 })
    expect(res).toBe('data:image/png;base64,mock-data')
    expect(drawnSizes[0]).toBe(256)
    expect(fakeCtx.drawImage).toHaveBeenCalledWith(fakeImg, 10, 20, 80, 80, 0, 0, 256, 256)
    vi.restoreAllMocks()
  })

  it('超过上限时逐步降阶尺寸直到满足上限', () => {
    const fakeCtx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      drawImage: vi.fn(),
    }
    const drawnSizes: number[] = []
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') {
        const c = {
          width: 0,
          height: 0,
          getContext: () => fakeCtx,
          toDataURL: (type: string) => {
            drawnSizes.push(c.width)
            // 256 与 200 返回过长字符串，160 及以下返回短字符串
            if (c.width > 160) {
              return `data:${type};base64,` + 'A'.repeat(1000)
            }
            return `data:${type};base64,short`
          },
        }
        return c as unknown as HTMLElement
      }
      return document.createElement(tag)
    })

    const fakeImg = {} as CanvasImageSource
    const res = cropAndCompressBallImage(fakeImg, { x: 0, y: 0, size: 100 }, 500)
    expect(res).toBe('data:image/png;base64,short')
    expect(drawnSizes).toEqual([256, 200, 160])
    vi.restoreAllMocks()
  })
})
