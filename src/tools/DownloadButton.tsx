import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import Tooltip from '@/ui/Tooltip'

import { defaultFileName, downloadDataUrl } from './file'

interface DownloadButtonProps {
  /** 文件的 MIME（决定默认下载名与 Blob 类型） */
  mime: string
  /** Data URL（含 base64 数据），用于还原文件 */
  dataUrl: string
  /** 按钮文案；缺省用「下载文件」 */
  label?: string
  className?: string
}

/** 通用「下载文件」按钮：点击时把 Data URL 还原为原始文件并触发下载。 */
export default function DownloadButton({ mime, dataUrl, label, className }: DownloadButtonProps) {
  const { t } = useTranslation()
  const filename = defaultFileName(mime)
  return (
    <Tooltip content={filename}>
      <button
        type='button'
        className={`tk-btn${className ? ` ${className}` : ''}`}
        aria-label={filename}
        onClick={() => downloadDataUrl(dataUrl, filename)}
      >
        <Icon name='download' size={13} />
        {label ?? t('tool.detect.download')}
      </button>
    </Tooltip>
  )
}
