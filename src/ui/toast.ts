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
/** 已排期的自动消失定时器：dismiss 或被挤出时必须清理，避免无效回调与定时器堆积 */
const timers = new Map<string, number>()

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
    const fallbackDuration = kind === 'err' ? 3000 : 2000
    const requested = options?.duration
    // 只有「有限且非负」的 duration 才生效：0 = 常驻；负数 / NaN / Infinity 属非法输入，回落默认时长
    const duration =
      requested === undefined || !Number.isFinite(requested) || requested < 0
        ? fallbackDuration
        : requested
    const icon = options?.icon
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const item: ToastItem = { id, message, kind, icon, duration }
    // 保持最多展示 3 条，最新触发的排在最前；被挤出的条目要连带清掉它的定时器
    const next = [item, ...toasts.filter((t) => t.id !== id)]
    for (const dropped of next.slice(3)) {
      const droppedTimer = timers.get(dropped.id)
      if (droppedTimer !== undefined) {
        window.clearTimeout(droppedTimer)
        timers.delete(dropped.id)
      }
    }
    toasts = next.slice(0, 3)
    emit()

    if (duration > 0) {
      timers.set(
        id,
        window.setTimeout(() => {
          toast.dismiss(id)
        }, duration),
      )
    }

    return id
  },
  dismiss(id?: string): void {
    if (id) {
      const timer = timers.get(id)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timers.delete(id)
      }
      toasts = toasts.filter((t) => t.id !== id)
    } else {
      // 清空时必须逐个 clearTimeout：否则已排期的回调仍会到点触发（虽然是无害 no-op）
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
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
