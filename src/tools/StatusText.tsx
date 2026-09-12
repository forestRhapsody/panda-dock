import type { ReactNode } from 'react'

export type ToolStatusKind = 'ok' | 'err' | 'info'

/** 工具区的通用状态对象（成功 / 错误 / 信息提示），各工具共用一套字段与类型 */
export interface ToolStatus {
  kind: ToolStatusKind
  text: string
}

/** 工具区的状态提示行：统一 .tw-status / .tw-status--{kind} 外观 */
export function StatusText({
  kind,
  className,
  children,
}: {
  kind: ToolStatusKind
  className?: string
  children: ReactNode
}) {
  // role="status" 自带隐式 aria-live="polite"：状态/错误出现时读屏会播报，
  // 不再只靠 `.tw-status--{kind}` 的 CSS 类表达。
  return (
    <p role='status' className={`tw-status tw-status--${kind}${className ? ` ${className}` : ''}`}>
      {children}
    </p>
  )
}
