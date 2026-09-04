/** 二维码生成与解析底层逻辑：封装 qrcode 与 jsQR 库。
 *  采用整数倍像素栅格（Integer Module Scaling）与禁用插值平滑，彻底杜绝亚像素锯齿与模糊，
 *  并支持边距调节、前景色/背景色、中心 Logo 安全衬垫与底部自定义字号标签合成。
 */
import jsQR from 'jsqr'
import QRCode from 'qrcode'

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

export interface GenerateQrOptions {
  /** 纠错等级：L (7%) / M (15%) / Q (25%) / H (30%)，默认 M */
  errorCorrectionLevel?: QrErrorCorrectionLevel
  /** 边距（留白格数），默认 2，支持 0 / 1 / 2 / 4 等 */
  margin?: number
  /** 目标基准像素宽，默认 800（将自动对齐为整像素倍数） */
  targetWidth?: number
  /** 前景色（如 #000000） */
  foregroundColor?: string
  /** 背景色（如 #ffffff） */
  backgroundColor?: string
  /** 中心 Logo 图像数据（DataURL 或 ObjectURL） */
  logoUrl?: string | null
  /** Logo 占二维码宽度的比例，默认 0.22 */
  logoSizeRatio?: number
  /** 底部说明文字 */
  label?: string | null
  /** 底部说明文字基础字号（CSS px，默认 18） */
  labelFontSize?: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

/** 绘制圆角矩形路径 */
function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius)
  } else {
    const r = Math.min(radius, w / 2, h / 2)
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
}

/**
 * 生成超清、零锯齿的高精度二维码合成 Canvas
 */
export async function generateQrCanvas(
  text: string,
  options: GenerateQrOptions = {},
): Promise<HTMLCanvasElement> {
  const {
    margin = 2,
    targetWidth = 800,
    foregroundColor = '#000000',
    backgroundColor = '#ffffff',
    logoUrl = null,
    logoSizeRatio = 0.22,
    label = null,
    labelFontSize = 18,
  } = options

  // 上传 Logo 时，自动使用最高纠错级别 H (30%) 保证扫码识别率
  const ecLevel: QrErrorCorrectionLevel = logoUrl ? 'H' : (options.errorCorrectionLevel ?? 'M')

  // 1. 生成二维码点阵元数据（BitMatrix）
  const qr = QRCode.create(text, { errorCorrectionLevel: ecLevel })
  const moduleCount = qr.modules.size
  const totalModules = moduleCount + margin * 2

  // 2. 计算精准整数倍点阵缩放尺度（Scale），杜绝任何浮点缩放导致的模糊与灰阶锯齿
  const scale = Math.max(1, Math.ceil(targetWidth / totalModules))
  const qrSize = totalModules * scale

  // 3. 计算底部标签高度
  const cleanLabel = label?.trim() ?? ''
  const hasLabel = Boolean(cleanLabel)
  // 基于 240px 预览基准计算字体缩放比
  const fontRatio = qrSize / 240
  const canvasFontSize = Math.round(labelFontSize * fontRatio)
  const labelHeight = hasLabel ? Math.round(canvasFontSize * 2.4) : 0
  const totalWidth = qrSize
  const totalHeight = qrSize + labelHeight

  // 4. 创建总画布
  const outCanvas = document.createElement('canvas')
  outCanvas.width = totalWidth
  outCanvas.height = totalHeight
  const ctx = outCanvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context not available')

  // 填充整块背景
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, totalWidth, totalHeight)

  // 5. 逐个点阵精准绘制二维码（整像素填充，绝对物理坐标对齐；关闭平滑防止方块边缘灰化）
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = foregroundColor
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.modules.get(row, col)) {
        const x = (col + margin) * scale
        const y = (row + margin) * scale
        ctx.fillRect(x, y, scale, scale)
      }
    }
  }

  // 6. 若配置了 Logo，在正中心合成并带防遮挡保护垫（开启高质量平滑缩放）
  if (logoUrl) {
    try {
      const logoImg = await loadImage(logoUrl)
      // Logo 大小取整
      const logoSize = Math.round(qrSize * logoSizeRatio)
      const centerX = Math.round((qrSize - logoSize) / 2)
      const centerY = Math.round((qrSize - logoSize) / 2)

      // 保护垫（背景色底框）
      const pad = Math.max(4, Math.round(scale * 1.2))
      const boxX = centerX - pad
      const boxY = centerY - pad
      const boxSize = logoSize + pad * 2
      const radius = Math.round(boxSize * 0.16)

      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = backgroundColor
      ctx.beginPath()
      pathRoundRect(ctx, boxX, boxY, boxSize, boxSize, radius)
      ctx.fill()

      // 细微浅边框增强视觉融合感
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)'
      ctx.lineWidth = Math.max(1, Math.round(scale * 0.15))
      ctx.stroke()

      // 圆角裁切绘制 Logo
      ctx.beginPath()
      pathRoundRect(ctx, centerX, centerY, logoSize, logoSize, Math.max(2, radius - 2))
      ctx.clip()
      ctx.drawImage(logoImg, centerX, centerY, logoSize, logoSize)
      ctx.restore()
    } catch {
      // 容错：Logo 异常时不阻断二维码正常导出
    }
  }

  // 7. 若配置了说明标签，绘制高质量居中文本
  if (hasLabel) {
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.font = `600 ${canvasFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
    ctx.fillStyle = foregroundColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // 超长文字智能截断加省略号
    const maxTextWidth = totalWidth * 0.9
    let textToDraw = cleanLabel
    if (ctx.measureText(textToDraw).width > maxTextWidth) {
      while (textToDraw.length > 1 && ctx.measureText(`${textToDraw}…`).width > maxTextWidth) {
        textToDraw = textToDraw.slice(0, -1)
      }
      textToDraw = `${textToDraw}…`
    }

    const labelY = qrSize + labelHeight / 2 - Math.round(fontRatio)
    ctx.fillText(textToDraw, totalWidth / 2, labelY)
    ctx.restore()
  }

  return outCanvas
}

/** 生成二维码 PNG 的超清 Data URL */
export async function generateQrCodeDataUrl(
  text: string,
  options: GenerateQrOptions = {},
): Promise<string> {
  const canvas = await generateQrCanvas(text, options)
  return canvas.toDataURL('image/png')
}

/** 生成二维码 PNG 的超清二进制 Blob */
export async function generateQrCodeBlob(
  text: string,
  options: GenerateQrOptions = {},
): Promise<Blob> {
  const canvas = await generateQrCanvas(text, options)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to create PNG blob from canvas'))
    }, 'image/png')
  })
}

/** 从图像 ImageData 数据中解码二维码文本 */
export function decodeQrCodeFromImageData(imageData: ImageData): string | null {
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  })
  return code?.data ?? null
}

/** 将 Blob 转为 HTMLImageElement */
function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

/** 从图片 Blob 中解析二维码 */
export async function decodeQrCodeFromBlob(blob: Blob): Promise<string> {
  const img = await loadImageFromBlob(blob)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context not available')
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = decodeQrCodeFromImageData(imageData)

  if (!result) {
    throw new Error('No QR code found in image')
  }

  return result
}
