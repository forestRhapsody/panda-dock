import { useEffect, useState } from 'react'

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
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    return toast.subscribe(setItems)
  }, [])

  if (items.length === 0) return null

  return (
    <div
      className={`tk-toaster tk-toaster--${position}`}
      role='region'
      aria-live='polite'
      aria-label='Notifications'
    >
      {items.map((item) => (
        <div key={item.id} className={`tk-toast tk-toast--${item.kind}`} role='status'>
          <div className='tk-toast__icon'>
            <Icon
              name={
                item.icon ??
                (item.kind === 'err' ? 'alert' : item.kind === 'info' ? 'alert' : 'check')
              }
              size={13}
            />
          </div>
          <div className='tk-toast__content'>
            <span className='tk-toast__title'>{item.message}</span>
          </div>
          <button
            type='button'
            className='tk-toast__close'
            aria-label='Close'
            title='Close'
            onClick={() => toast.dismiss(item.id)}
          >
            <Icon name='close' size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
