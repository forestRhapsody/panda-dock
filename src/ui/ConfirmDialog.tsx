import { useEffect, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  title: string
  message: string
  /** 确定按钮文案，缺省用 `common.confirm` */
  confirmLabel?: string
  /** 取消按钮文案，缺省用 `common.cancel` */
  cancelLabel?: string
  /** 危险/不可逆操作（红色按钮与警告图标） */
  danger?: boolean
  /** 点击遮罩背景是否关闭，默认 false（防止误触丢失） */
  closeOnBackdrop?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 通用确认弹窗（替代 window.confirm）。
 * content script（网页内抽屉 Shadow DOM）里 window.confirm 会被 Chrome 禁用，
 * 用 React 渲染的弹窗在侧边栏 / 抽屉 / 设置页都能可靠弹出。
 * 行为：
 * - 默认点击遮罩背景不关闭（防误触，带轻微振动反馈），仅 Escape 与「取消」按钮关闭；
 * - 支持 danger 模式（红色警告按钮与警告图标）。
 * 样式走 ui.css 的 .tk-modal。
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  closeOnBackdrop = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    // 危险操作默认聚焦取消按钮以防手滑误按回车，常规操作聚焦确定按钮
    if (danger) {
      cancelRef.current?.focus()
    } else {
      confirmRef.current?.focus()
    }
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onCancel, danger])

  const handleOverlayClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && closeOnBackdrop) {
      onCancel()
    }
  }

  return (
    <div
      className='tk-modal'
      role='alertdialog'
      aria-modal='true'
      aria-label={title}
      onClick={handleOverlayClick}
    >
      <div className='tk-modal__card' onClick={(e) => e.stopPropagation()}>
        <h3 className='tk-modal__title'>{title}</h3>
        <p className='tk-modal__msg'>{message}</p>
        <div className='tk-modal__actions'>
          <button type='button' ref={cancelRef} className='tk-btn' onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type='button'
            ref={confirmRef}
            className={`tk-btn ${danger ? 'tk-btn--danger' : 'tk-btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
