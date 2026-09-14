import { BALL_IMAGE_MAX_DATA_URL_LENGTH } from './settings'

export interface CropRect {
  x: number
  y: number
  size: number
}

/**
 * 限制裁剪偏移量，确保图片始终填满裁剪框不露白。
 */
export function clampCropOffset(
  ox: number,
  oy: number,
  currentZoom: number,
  imgW: number,
  imgH: number,
  cropOffset: number,
  cropSize: number,
  baseScale: number,
): { x: number; y: number } {
  const renderW = imgW * baseScale * currentZoom
  const renderH = imgH * baseScale * currentZoom

  const minX = cropOffset + cropSize - renderW
  const maxX = cropOffset
  const minY = cropOffset + cropSize - renderH
  const maxY = cropOffset

  return {
    x: Math.min(maxX, Math.max(minX, ox)),
    y: Math.min(maxY, Math.max(minY, oy)),
  }
}

/**
 * 根据视口偏移量与缩放比例，计算在原图坐标系下的裁剪矩形 (x, y, size)。
 */
export function computeCropParams(
  offset: { x: number; y: number },
  zoom: number,
  baseScale: number,
  cropOffset: number,
  cropSize: number,
): CropRect {
  const scaleFactor = baseScale * zoom
  return {
    x: Math.max(0, (cropOffset - offset.x) / scaleFactor),
    y: Math.max(0, (cropOffset - offset.y) / scaleFactor),
    size: cropSize / scaleFactor,
  }
}

/**
 * 将原图的指定区域裁剪并压缩输出为 base64 data URL。
 * 策略：
 * 1. 悬浮球最大显示尺寸为 56px（Retina 3x 为 168px），因此默认以 256x256 采样，提供高清晰度；
 * 2. 依次尝试 256 -> 200 -> 160 -> 128 -> 96 -> 64 像素的 PNG 格式；
 * 3. 一旦输出 dataURL 长度满足存储上限 (BALL_IMAGE_MAX_DATA_URL_LENGTH)，立即返回；
 * 4. 若极端情况下 64x64 PNG 仍超标，回退至高质量 JPEG。
 */
export function cropAndCompressBallImage(
  img: CanvasImageSource,
  crop: CropRect,
  maxDataUrlLength: number = BALL_IMAGE_MAX_DATA_URL_LENGTH,
): string | null {
  const sizes = [256, 200, 160, 128, 96, 64]
  for (const size of sizes) {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size)
    const pngUrl = canvas.toDataURL('image/png')
    if (pngUrl.length <= maxDataUrlLength) {
      return pngUrl
    }
  }

  // 极端后备：JPEG 压缩
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, 128, 128)
  const jpegUrl = canvas.toDataURL('image/jpeg', 0.8)
  if (jpegUrl.length <= maxDataUrlLength) {
    return jpegUrl
  }
  return null
}

export interface ExportCroppedOptions {
  exportSize?: number
  autoCompress?: boolean
  maxDataUrlLength?: number
}

/**
 * 导出裁剪后的图片。
 * - 当 autoCompress 为 true 时，逐步降阶压缩至指定大小内；
 * - 默认以 exportSize（默认 600）导出高保真 PNG。
 */
export function exportCroppedCanvas(
  img: CanvasImageSource,
  crop: CropRect,
  options: ExportCroppedOptions = {},
): string | null {
  if (options.autoCompress) {
    return cropAndCompressBallImage(img, crop, options.maxDataUrlLength)
  }
  const size = options.exportSize ?? 600
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size)
  return canvas.toDataURL('image/png')
}
