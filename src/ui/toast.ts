import type { IconName } from './Icon'

export type ToastKind = 'success' | 'err' | 'info' | 'default'

export interface ToastOptions {
  kind?: ToastKind
  icon?: IconName
  duration?: number
}

export interface ToastItem {
  id: string
  message: string
  kind: ToastKind
  icon?: IconName
  duration?: number
}

type ToastListener = (toasts: ToastItem[]) => void

let toasts: ToastItem[] = []
const listeners = new Set<ToastListener>()

function emit(): void {
  listeners.forEach((fn) => fn([...toasts]))
}

/**
 * 极简、零依赖的 Sonner 级 Toast 事件管理器。
 * 遵循 Sonner / shadcn 风格与 API 设计，完美兼容 Shadow DOM 与 Chrome 扩展侧边栏。
 */
export const toast = {
  success(message: string, options?: number | Omit<ToastOptions, 'kind'>): string {
    const opts = typeof options === 'number' ? { duration: options } : options
    return toast.create(message, { ...opts, kind: 'success' })
  },
  error(message: string, options?: number | Omit<ToastOptions, 'kind'>): string {
    const opts = typeof options === 'number' ? { duration: options } : options
    return toast.create(message, { ...opts, kind: 'err' })
  },
  info(message: string, options?: number | Omit<ToastOptions, 'kind'>): string {
    const opts = typeof options === 'number' ? { duration: options } : options
    return toast.create(message, { ...opts, kind: 'info' })
  },
  create(message: string, options?: ToastOptions): string {
    const kind = options?.kind ?? 'default'
    const duration = options?.duration ?? (kind === 'err' ? 3000 : 2000)
    const icon = options?.icon
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const item: ToastItem = { id, message, kind, icon, duration }
    // 保持最多展示 3 条，最新触发的排在最前
    toasts = [item, ...toasts.filter((t) => t.id !== id)].slice(0, 3)
    emit()

    if (duration > 0) {
      window.setTimeout(() => {
        toast.dismiss(id)
      }, duration)
    }

    return id
  },
  dismiss(id?: string): void {
    if (id) {
      toasts = toasts.filter((t) => t.id !== id)
    } else {
      toasts = []
    }
    emit()
  },
  subscribe(listener: ToastListener): () => void {
    listeners.add(listener)
    listener([...toasts])
    return () => {
      listeners.delete(listener)
    }
  },
}
