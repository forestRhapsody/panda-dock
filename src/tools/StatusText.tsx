import type { ReactNode } from 'react'

export type ToolStatusKind = 'ok' | 'err' | 'info'

/** 工具区的通用状态对象（成功 / 错误 / 信息提示），各工具共用一套字段与类型 */
export interface ToolStatus {
  kind: ToolStatusKind
  text: string
}

/** 工具区的状态提示行：统一 .tw-status / .tw-status--{kind} 外观 */
export function StatusText({ kind, children }: { kind: ToolStatusKind; children: ReactNode }) {
  return <p className={`tw-status tw-status--${kind}`}>{children}</p>
}
