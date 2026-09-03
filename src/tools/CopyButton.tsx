import { useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import { copyText } from '@/utils/clipboard'

interface CopyButtonProps {
  /** 要复制的文本 */
  text: string
  disabled?: boolean
  className?: string
  title?: string
  label?: string
  /** 复制成功后的短时文案 */
  copiedLabel?: string
  /** 是否只显示图标（复制 / 对勾），而非文字 */
  icon?: boolean
  /** 复制结果回调（ok=true 成功） */
  onResult?: (ok: boolean) => void
}

/** 复制按钮：点击后短暂显示「已复制」，过一会儿变回原文案（icon 模式显示图标）。 */
export default function CopyButton({
  text,
  disabled,
  className,
  title,
  label,
  copiedLabel,
  icon = false,
  onResult,
}: CopyButtonProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const labelText = label ?? t('common.copy')
  const copiedText = copiedLabel ?? t('common.copied')

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function handleClick() {
    const ok = await copyText(text)
    onResult?.(ok)
    if (!ok) return
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type='button'
      className={className}
      title={title ?? labelText}
      aria-label={labelText}
      aria-live='polite'
      disabled={disabled}
      onClick={() => void handleClick()}
    >
      {icon ? <Icon name={copied ? 'check' : 'copy'} size={14} /> : copied ? copiedText : labelText}
    </button>
  )
}
