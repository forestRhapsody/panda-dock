import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

interface NumberInputProps {
  value: number
  min?: number
  max?: number
  onChange: (val: number) => void
  className?: string
  'aria-label'?: string
}

/**
 * 受控数字输入组件：
 * 解决原生 type='number' 在受控模式下无法删空、无法从空重新输入的体验缺陷。
 * 允许用户临时删成空字符串重新输入，在失焦或回车时做边界夹紧。
 */
export default function NumberInput({
  value,
  min = 0,
  max = 800,
  onChange,
  className,
  'aria-label': ariaLabel,
}: NumberInputProps) {
  const [text, setText] = useState(() => String(value))
  const lastDispatchedRef = useRef<number>(value)

  // 外部主动变更（如重置默认配置）时同步输入框内容
  useEffect(() => {
    if (value !== lastDispatchedRef.current) {
      lastDispatchedRef.current = value
      setText(String(value))
    }
  }, [value])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setText(raw)
    // 允许用户临时删空，不打断输入
    if (raw === '') return
    const num = parseInt(raw, 10)
    if (!Number.isNaN(num)) {
      const clamped = Math.max(min, Math.min(num, max))
      lastDispatchedRef.current = clamped
      onChange(clamped)
    }
  }

  const handleBlur = () => {
    if (text === '' || Number.isNaN(parseInt(text, 10))) {
      setText(String(value))
      lastDispatchedRef.current = value
      onChange(value)
    } else {
      const clamped = Math.max(min, Math.min(parseInt(text, 10), max))
      setText(String(clamped))
      lastDispatchedRef.current = clamped
      onChange(clamped)
    }
  }

  return (
    <input
      type='number'
      min={min}
      max={max}
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
      aria-label={ariaLabel}
    />
  )
}
