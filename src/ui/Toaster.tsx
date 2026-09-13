import { useEffect, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from './Icon'
import { toast } from './toast'
import type { ToastItem } from './toast'

interface ToasterProps {
  /** 弹出位置：默认 bottom（下方居中，自然不遮挡顶栏） */
  position?: 'top' | 'bottom'
}

/**
 * 严格对齐 Sonner / shadcn 规范的 Toaster 容器。
 * 支持堆叠、精致图标徽章、关闭按钮与弹性上升微动效。
 */
export default function Toaster({ position = 'bottom' }: ToasterProps) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    return toast.subscribe(setItems)
  }, [])

  // 空列表也必须常驻 live region 容器：若容器随内容一起创建销毁，读屏可能在
  // 第一次公告发出前还没订阅到该区域，导致首条通知漏播。空容器是 flex 布局且
  // pointer-events: none，内部无通知时不占位、不遮挡交互，故不改变现有定位/类名契约。
  return (
    <div
      className={`pd-toaster pd-toaster--${position}`}
      role='region'
      aria-live='polite'
      aria-label={t('common.notifications')}
    >
      {items.map((item) => (
        <div key={item.id} className={`pd-toast pd-toast--${item.kind}`} role='status'>
          <div className='pd-toast__icon'>
            <Icon
              name={
                item.icon ??
                (item.kind === 'err' ? 'alert' : item.kind === 'info' ? 'info' : 'check')
              }
              size={13}
            />
          </div>
          <div className='pd-toast__content'>
            <span className='pd-toast__title'>{item.message}</span>
          </div>
          <button
            type='button'
            className='pd-toast__close'
            aria-label={t('common.close')}
            onClick={() => toast.dismiss(item.id)}
          >
            <Icon name='close' size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
