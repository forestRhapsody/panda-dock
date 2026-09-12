import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * 统一的「空输入错误」状态管理 Hook。
 *
 * 用法：
 * ```tsx
 * const { emptyErr, areaRef, triggerEmpty, clearEmpty } = useEmptyError<HTMLTextAreaElement>()
 *
 * // 操作按钮点击时，若输入为空：
 * if (!input.trim()) { triggerEmpty(); return }
 *
 * // 输入框 className：
 * className={`tw-area${emptyErr ? ' tw-area--empty-err' : ''}`}
 * ref={areaRef}
 *
 * // 输入内容变化时：
 * onChange={(e) => { if (emptyErr) clearEmpty(); setInput(e.target.value) }}
 * ```
 *
 * 对应 §4 条 15：「空输入点操作按钮时输入框变红（.tw-area--empty-err）+ 自动聚焦，不弹文字横幅」。
 */
export function useEmptyError<T extends HTMLElement = HTMLTextAreaElement>(): {
  /** 是否处于空输入错误状态 */
  emptyErr: boolean
  /** 绑定到输入框的 ref，triggerEmpty 会自动聚焦它 */
  areaRef: RefObject<T | null>
  /** 触发空输入错误：设置 emptyErr=true 并聚焦输入框 */
  triggerEmpty: () => void
  /** 清除空输入错误状态 */
  clearEmpty: () => void
} {
  const [emptyErr, setEmptyErr] = useState(false)
  const areaRef = useRef<T>(null)

  const triggerEmpty = useCallback(() => {
    setEmptyErr(true)
    areaRef.current?.focus()
  }, [])

  const clearEmpty = useCallback(() => {
    setEmptyErr(false)
  }, [])

  return { emptyErr, areaRef, triggerEmpty, clearEmpty }
}
