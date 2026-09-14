import ImageCropModal from '@/ui/ImageCropModal'

import type { QrLogoShape } from './qrcode'

export interface QrLogoCropModalProps {
  /** 待裁剪的原图 URL（ObjectURL 或 DataURL） */
  imageSrc: string
  /** 初始形状 */
  initialShape?: QrLogoShape
  /** 确认裁剪回调，输出 1:1 高清 DataURL 及所选形状 */
  onConfirm: (croppedDataUrl: string, selectedShape: QrLogoShape) => void
  /** 取消关闭回调 */
  onCancel: () => void
}

/**
 * 二维码 Logo 裁剪弹窗，基于通用 ImageCropModal 组件。
 * 保留固定 export 签名以兼容各处引用与 DOM 测试桩。
 */
export default function QrLogoCropModal({
  imageSrc,
  initialShape = 'rounded',
  onConfirm,
  onCancel,
}: QrLogoCropModalProps) {
  return (
    <ImageCropModal
      imageSrc={imageSrc}
      shape={initialShape}
      allowShapeSelect
      exportSize={600}
      onConfirm={(dataUrl, shape) => onConfirm(dataUrl, shape as QrLogoShape)}
      onCancel={onCancel}
    />
  )
}
