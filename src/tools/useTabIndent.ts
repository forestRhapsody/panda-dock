import { useCallback, useRef } from 'react'
import type { KeyboardEventHandler } from 'react'

import { computeTabIndent, TAB_INDENT, type TabIndentEdit } from './tabIndent'

/**
 * 把缩进结果写回 textarea，并让受控组件收到 onChange。
 *
 * 首选 `document.execCommand('insertText')`：它走浏览器原生编辑路径，既进撤销栈（Ctrl+Z 能撤销
 * 这次缩进），也自带原生 input 事件。兜底路径（happy-dom 等没有 execCommand 的环境）必须用原型
 * `value` setter 而不是直接 `ta.value = ...`：React 把 value tracker 挂在元素实例的 value 描述符上，
 * 直接赋值会被 tracker 吞掉，随后的 input 事件就不再触发受控组件的 onChange。
 */
function applyEdit(ta: HTMLTextAreaElement, edit: TabIndentEdit): void {
  ta.setSelectionRange(0, ta.value.length)
  let applied = false
  try {
    applied =
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, edit.value) &&
      ta.value === edit.value
  } catch {
    applied = false
  }

  if (!applied) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      ta,
      edit.value,
    )
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }

  ta.setSelectionRange(edit.start, edit.end)
}

export interface TabIndentOptions {
  /** 缩进单元，跟随使用方的设置（JSON 工作台是 Tab / 2 / 4） */
  indent?: string
  /** 使用方自己的 onKeyDown：先执行，且它 preventDefault 后本 hook 不再接管 */
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
}

/**
 * 「手写整段结构」的编辑器才用的 Tab 缩进（当前只有 JSON 工作台的输入区）。
 * 数据输入框（Base64 / Hash / QR / URL / Cookie / 时间戳…）**不要**接：往里插空格会污染
 * 待处理的数据，且 Tab 退出焦点在这些框里是主用键。
 *
 * - Tab 缩进 / Shift+Tab 反缩进；
 * - 焦点可达性兜底（一次性放行）：`Esc` 或 `Ctrl/Cmd+M`，其后的第一个 Tab / Shift+Tab 交还
 *   焦点导航。抽屉里 `Esc` 被「关闭抽屉」占用，所以另给一个 `Ctrl/Cmd+M` 作为等价出口。
 * - 只读 / 禁用 / 输入法组合中的按键一律不拦截。
 */
export function useTabIndent({
  indent = TAB_INDENT,
  onKeyDown,
}: TabIndentOptions = {}): KeyboardEventHandler<HTMLTextAreaElement> {
  // 一次性放行标记
  const escaped = useRef(false)

  return useCallback<KeyboardEventHandler<HTMLTextAreaElement>>(
    (e) => {
      onKeyDown?.(e)
      // 调用方已处理（如 Ctrl+Enter 执行）时不插手
      if (e.defaultPrevented) return

      const ta = e.currentTarget
      if (ta.readOnly || ta.disabled || e.nativeEvent.isComposing) return

      if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm')) {
        if (e.key !== 'Escape') e.preventDefault()
        escaped.current = true
        return
      }
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) {
        escaped.current = false
        return
      }
      if (escaped.current) {
        escaped.current = false
        return
      }

      e.preventDefault()
      const edit = computeTabIndent(
        ta.value,
        ta.selectionStart ?? 0,
        ta.selectionEnd ?? 0,
        e.shiftKey,
        indent,
      )
      applyEdit(ta, edit)
    },
    [indent, onKeyDown],
  )
}
