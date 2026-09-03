import { useEffect, useRef, useState } from 'react'

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
  /** 复制结果回调（ok=true 成功） */
  onResult?: (ok: boolean) => void
}

/** 复制按钮：点击后短暂显示「已复制」，过一会儿变回原文案。 */
export default function CopyButton({
  text,
  disabled,
  className,
  title,
  label = '复制',
  copiedLabel = '已复制',
  onResult,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

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
      title={title}
      aria-live='polite'
      disabled={disabled}
      onClick={() => void handleClick()}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}
