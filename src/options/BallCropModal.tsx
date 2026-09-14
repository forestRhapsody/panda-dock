import { useTranslation } from 'react-i18next'

import ImageCropModal from '@/ui/ImageCropModal'
import type { BallShape } from '@/utils/settings'

export interface BallCropModalProps {
  /** 待裁剪的原图 URL（ObjectURL 或 DataURL） */
  imageSrc: string
  /** 悬浮球形状（圆形 / 圆角矩形 / 矩形），用于渲染对应的裁剪边框 */
  shape?: BallShape
  /** 确认裁剪回调，输出压缩后的 DataURL */
  onConfirm: (croppedDataUrl: string) => void
  /** 取消关闭回调 */
  onCancel: () => void
}

/**
 * 悬浮球自定义图片裁剪弹窗，基于通用 ImageCropModal 组件。
 * 开启自动降阶压缩（autoCompress）以满足扩展存储配额，关闭形状选择（跟随设置单选）。
 */
export default function BallCropModal({
  imageSrc,
  shape = 'circle',
  onConfirm,
  onCancel,
}: BallCropModalProps) {
  const { t } = useTranslation()

  return (
    <ImageCropModal
      imageSrc={imageSrc}
      shape={shape}
      allowShapeSelect={false}
      autoCompress
      labels={{
        title: t('settings.ballCropTitle'),
        hint: t('settings.ballCropHint'),
        reset: t('settings.ballCropReset'),
        zoom: t('settings.ballCropZoom'),
        confirm: t('settings.ballCropConfirm'),
        loadError: t('settings.ballCropLoadError'),
        exportError: t('settings.ballCropExportError'),
      }}
      onConfirm={(dataUrl) => onConfirm(dataUrl)}
      onCancel={onCancel}
    />
  )
}
