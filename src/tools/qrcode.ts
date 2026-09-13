/** 二维码生成与解析底层逻辑：封装 qrcode 与 jsQR 库。
 *  采用整数倍像素栅格（Integer Module Scaling）与禁用插值平滑，彻底杜绝亚像素锯齿与模糊，
 *  并支持边距调节、前景色/背景色、中心 Logo 安全衬垫与底部自定义字号标签合成。
 */
import jsQR from 'jsqr'
import QRCode from 'qrcode'

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'
export type QrLogoShape = 'circle' | 'rounded' | 'square'
export type QrLogoMargin = 'none' | 'tight' | 'standard'

/**
 * 默认纠错级别：M (15%)，是产品级默认值的唯一来源
 * （工具初始态、恢复默认、无 Logo 时生成都引用它，避免四处硬编码后改默认漏改）。
 *
 * 为什么是 M：L 只有 7% 冗余，屏幕反光 / 拍照角度 / 边缘轻微污损就可能扫不出来；
 * H 的 30% 冗余会让点阵明显变密（62 字网址 37 → 49 模块），而真正需要 H 的只有
 * 「中心嵌入 Logo」——那种情况已在 generateQrCodeResult 内部强制升级，无需抬高全局默认。
 */
export const DEFAULT_EC_LEVEL: QrErrorCorrectionLevel = 'M'

export interface QrStylePreset {
  margin?: number
  resolution?: number
  fgColor?: string
  bgColor?: string
  labelFontSize?: number
  logoShape?: QrLogoShape
  logoSizeRatio?: number
  logoMargin?: QrLogoMargin | boolean
  ecLevel?: QrErrorCorrectionLevel
}

export const QR_STYLE_PRESET_KEY = 'panda.qrcode.stylePreset'

/**
 * 生成页的「合成参数」——决定这张二维码长什么样、底部写什么字的全部输入。
 *
 * 它走**会话草稿**（`chrome.storage.session`，标签页级工作区）：关抽屉 / 关侧栏再打开、
 * 页面刷新都还在，关标签页或关浏览器才清空。与 `QR_STYLE_PRESET_KEY`（用户显式点
 * 「保存为默认样式」后才写入 `chrome.storage.local` 的长期偏好）是两回事：
 * 前者记住「我刚才调到哪儿了」，后者记住「我认可的默认长什么样」。
 */
export interface QrComposeDraft {
  ecLevel: QrErrorCorrectionLevel
  /** 因嵌入 Logo 被锁定为 H 之前的用户等级；null 表示当前没有这层锁定 */
  ecLevelBeforeLogo: QrErrorCorrectionLevel | null
  margin: number
  resolution: number
  fgColor: string
  bgColor: string
  labelFontSize: number
  /** 底部说明文字（属于内容，重开抽屉必须还在） */
  label: string
  logoShape: QrLogoShape
  logoSizeRatio: number
  logoMargin: QrLogoMargin
}

export const DEFAULT_QR_COMPOSE: QrComposeDraft = {
  ecLevel: DEFAULT_EC_LEVEL,
  ecLevelBeforeLogo: null,
  margin: 2,
  resolution: 1200,
  fgColor: '#000000',
  bgColor: '#ffffff',
  labelFontSize: 18,
  label: '',
  logoShape: 'rounded',
  logoSizeRatio: 0.22,
  logoMargin: 'standard',
}

/**
 * 把「保存的默认样式」映射成合成参数（只覆盖它声明过的字段）。
 * 仅在**没有**会话草稿时调用：草稿代表用户本次会话的最新调整，优先级更高。
 */
export function presetToCompose(preset: QrStylePreset): Partial<QrComposeDraft> {
  const out: Partial<QrComposeDraft> = {}
  if (preset.margin !== undefined) out.margin = preset.margin
  if (preset.resolution !== undefined) out.resolution = preset.resolution
  if (preset.fgColor !== undefined) out.fgColor = preset.fgColor
  if (preset.bgColor !== undefined) out.bgColor = preset.bgColor
  if (preset.labelFontSize !== undefined) out.labelFontSize = preset.labelFontSize
  if (preset.logoShape !== undefined) out.logoShape = preset.logoShape
  if (preset.logoSizeRatio !== undefined) out.logoSizeRatio = preset.logoSizeRatio
  if (preset.logoMargin !== undefined) {
    // 历史数据里 logoMargin 可能是 boolean（true=standard / false=none）
    out.logoMargin =
      preset.logoMargin === false
        ? 'none'
        : preset.logoMargin === true
          ? 'standard'
          : preset.logoMargin
  }
  if (preset.ecLevel !== undefined) {
    out.ecLevel = preset.ecLevel
    // 与「上传 Logo 前先记住原等级」同一语义：这里的等级就是用户原本想用的等级
    out.ecLevelBeforeLogo = preset.ecLevel
  }
  return out
}

export interface GenerateQrOptions {
  /** 纠错等级：L (7%) / M (15%) / Q (25%) / H (30%)，默认 DEFAULT_EC_LEVEL（M） */
  errorCorrectionLevel?: QrErrorCorrectionLevel
  /** 边距（留白格数），默认 2，支持 0 / 1 / 2 / 4 等 */
  margin?: number
  /** 目标基准像素宽，默认 1200（将自动对齐为整像素倍数，支持 800 / 1200 / 1600 / 2400） */
  targetWidth?: number
  /** 前景色（如 #000000） */
  foregroundColor?: string
  /** 背景色（如 #ffffff） */
  backgroundColor?: string
  /** 中心 Logo 图像数据（DataURL 或 ObjectURL） */
  logoUrl?: string | null
  /** Logo 形状：circle (圆形) / rounded (平滑圆角) / square (直角)，默认 rounded */
  logoShape?: QrLogoShape
  /** Logo 占二维码宽度的比例，默认 0.22 */
  logoSizeRatio?: number
  /** Logo 外围保护垫边距：none (无边框) / tight (紧凑) / standard (默认)，默认 standard */
  logoMargin?: QrLogoMargin | boolean
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
async function generateQrCanvas(
  text: string,
  options: GenerateQrOptions = {},
): Promise<HTMLCanvasElement> {
  const {
    margin = 2,
    targetWidth = 1200,
    foregroundColor = '#000000',
    backgroundColor = '#ffffff',
    logoUrl = null,
    logoShape = 'rounded',
    logoSizeRatio = 0.22,
    logoMargin = 'standard',
    label = null,
    labelFontSize = 18,
  } = options

  // 上传 Logo 时，自动使用最高纠错级别 H (30%) 保证扫码识别率
  const ecLevel: QrErrorCorrectionLevel = logoUrl
    ? 'H'
    : (options.errorCorrectionLevel ?? DEFAULT_EC_LEVEL)

  // 1. 生成二维码点阵元数据（BitMatrix）
  const qr = QRCode.create(text, { errorCorrectionLevel: ecLevel })
  const moduleCount = qr.modules.size
  const totalModules = moduleCount + margin * 2

  // 2. 保持画布主体尺寸严格等于用户所选的分辨率 targetWidth（如 800 / 1200 / 1600 / 2400）
  // 边距选项仅控制点阵所占比例与内部留白，与画布整体导出尺寸完全解耦独立
  const qrSize = targetWidth
  const scale = Math.max(1, Math.floor(qrSize / totalModules))
  const qrContentSize = moduleCount * scale
  // 水平与垂直方向居中对齐点阵（多余像素均匀对称分布至两侧留白，整像素对齐杜绝亚像素锯齿）
  const offsetX = Math.round((qrSize - qrContentSize) / 2)
  const offsetY = Math.round((qrSize - qrContentSize) / 2)

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
        const x = offsetX + col * scale
        const y = offsetY + row * scale
        ctx.fillRect(x, y, scale, scale)
      }
    }
  }

  // 6. 若配置了 Logo，在正中心合成并带防遮挡保护垫（开启高质量平滑缩放与防拉伸处理）
  if (logoUrl) {
    try {
      const logoImg = await loadImage(logoUrl)
      // Logo 绘制尺寸（依设定的比例取整）
      const logoSize = Math.round(qrSize * logoSizeRatio)
      const centerX = Math.round((qrSize - logoSize) / 2)
      const centerY = Math.round((qrSize - logoSize) / 2)

      // 保护垫（背景色衬底框）：
      // - standard（或 true）：约 1 个 module 宽度，适中留白
      // - tight：约 0.45 个 module 宽度，紧凑贴合
      // - none（或 false）：无间距，点阵紧靠 Logo 边缘，不画微边框
      let pad = 0
      if (logoMargin === 'tight') {
        pad = Math.max(2, Math.round(scale * 0.45))
      } else if (logoMargin === 'standard' || logoMargin === true || logoMargin === undefined) {
        pad = Math.max(3, Math.round(scale * 0.9))
      }
      const hasPad = pad > 0
      const boxX = centerX - pad
      const boxY = centerY - pad
      const boxSize = logoSize + pad * 2

      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = backgroundColor

      // 绘制保护垫底框路径（用于遮蔽中心区域的二维码点阵）
      ctx.beginPath()
      if (logoShape === 'circle') {
        const cX = centerX + logoSize / 2
        const cY = centerY + logoSize / 2
        ctx.arc(cX, cY, boxSize / 2, 0, Math.PI * 2)
      } else if (logoShape === 'square') {
        ctx.rect(boxX, boxY, boxSize, boxSize)
      } else {
        // rounded 平滑圆角
        const radius = hasPad ? Math.round(boxSize * 0.22) : Math.round(logoSize * 0.2)
        pathRoundRect(ctx, boxX, boxY, boxSize, boxSize, radius)
      }
      ctx.fill()

      // 计算源图等比裁剪（cover），彻底杜绝拉伸畸变
      const imgW = logoImg.naturalWidth || logoImg.width
      const imgH = logoImg.naturalHeight || logoImg.height
      let sx = 0
      let sy = 0
      const sSize = Math.min(imgW, imgH)
      if (imgW > imgH) {
        sx = Math.round((imgW - imgH) / 2)
      } else if (imgH > imgW) {
        sy = Math.round((imgH - imgW) / 2)
      }

      // 创建 Logo 形状的裁切蒙版并绘制图片
      ctx.beginPath()
      if (logoShape === 'circle') {
        const cX = centerX + logoSize / 2
        const cY = centerY + logoSize / 2
        ctx.arc(cX, cY, logoSize / 2, 0, Math.PI * 2)
      } else if (logoShape === 'square') {
        ctx.rect(centerX, centerY, logoSize, logoSize)
      } else {
        const innerRadius = Math.round(logoSize * 0.2)
        pathRoundRect(ctx, centerX, centerY, logoSize, logoSize, innerRadius)
      }
      ctx.clip()

      ctx.drawImage(logoImg, sx, sy, sSize, sSize, centerX, centerY, logoSize, logoSize)
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

    // 二维码点阵实际结束的底边物理坐标
    const qrModulesBottom = offsetY + qrContentSize
    // 说明标签在二维码点阵底边与画布底边之间的整块空白区域内严格垂直居中
    const labelY = Math.round((qrModulesBottom + totalHeight) / 2)
    ctx.fillText(textToDraw, totalWidth / 2, labelY)
    ctx.restore()
  }

  return outCanvas
}

/** 生成二维码 PNG 的超清 Data URL 及物理像素尺寸 */
export async function generateQrCodeResult(
  text: string,
  options: GenerateQrOptions = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  const canvas = await generateQrCanvas(text, options)
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  }
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
function decodeQrCodeFromImageData(imageData: ImageData): string | null {
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
