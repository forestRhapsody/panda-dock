import { useEffect, useRef } from 'react'

import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  title: string
  message: string
  /** 确定按钮文案，缺省用 `common.confirm` */
  confirmLabel?: string
  /** 取消按钮文案，缺省用 `common.cancel` */
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 通用确认弹窗（替代 window.confirm）。
 * content script（网页内抽屉 Shadow DOM）里 window.confirm 会被 Chrome 禁用，
 * 用 React 渲染的弹窗在侧边栏 / 抽屉 / 设置页都能可靠弹出。
 * 行为：Escape / 点遮罩取消；打开后自动聚焦「确定」。
 * 样式走 ui.css 的 .tk-modal（各入口互通，弹层在同一 stacking context 内盖在内容之上）。
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    confirmRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className='tk-modal'
      role='alertdialog'
      aria-modal='true'
      aria-label={title}
      onClick={onCancel}
    >
      <div className='tk-modal__card' onClick={(e) => e.stopPropagation()}>
        <h3 className='tk-modal__title'>{title}</h3>
        <p className='tk-modal__msg'>{message}</p>
        <div className='tk-modal__actions'>
          <button type='button' className='tk-btn' onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type='button'
            ref={confirmRef}
            className='tk-btn tk-btn--primary'
            onClick={onConfirm}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
