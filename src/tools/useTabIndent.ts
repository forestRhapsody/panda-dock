import { useCallback, useRef } from 'react'
import type { KeyboardEventHandler } from 'react'

import { computeTabIndent, type TabIndentEdit } from './tabIndent'

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

/**
 * 多行编辑框的 Tab 行为：Tab / Shift+Tab 缩进与反缩进，而不是直接把焦点移走。
 * 键盘可达性用「Esc 之后的 Tab」兜底：按一下 Escape，下一个 Tab / Shift+Tab 交还给焦点导航
 * （VS Code / DevTools 的通行约定）。只读 / 禁用 / 输入法组合中的按键一律不拦截。
 */
export function useTabIndent(
  externalOnKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>,
): KeyboardEventHandler<HTMLTextAreaElement> {
  // Esc 后的一次性放行标记
  const escaped = useRef(false)

  return useCallback<KeyboardEventHandler<HTMLTextAreaElement>>(
    (e) => {
      externalOnKeyDown?.(e)
      // 调用方已处理（如 Ctrl+Enter 执行、Escape 取消编辑）时不插手
      if (e.defaultPrevented) return

      const ta = e.currentTarget
      if (ta.readOnly || ta.disabled || e.nativeEvent.isComposing) return

      if (e.key === 'Escape') {
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
      )
      applyEdit(ta, edit)
    },
    [externalOnKeyDown],
  )
}
