import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import { storageGet, storageRemove, storageSet } from '@/utils/env'

const DRAFT_PREFIX = 'toolkit.draft.'
const memoryCache = new Map<string, unknown>()

/**
 * 标签页作用域 Context：向子树提供当前宿主所属的 tabId。
 * 每个 Tab（标签页）拥有独立的草稿工作区，不同标签页之间（如 a.com 与 b.com）互不干扰；
 * 同一 Tab 内的网页抽屉与原生侧边栏拥有相同 tabId，实现同标签页内无缝连续与实时同步；
 * 标签页关闭时自动清理该 tabId 的所有草稿，释放存储配额。
 * 未提供（如 happy-dom 单测或 dev 预览）时为 null，自动回退到无前缀全局 key。
 */
export const TabScopeContext = createContext<number | null>(null)
/** 兼容历史命名的别名 */
export const WindowScopeContext = TabScopeContext

/** 根据可选的 tabId 计算实际的草稿存储键 */
export function getScopedDraftKey(key: string, tabId?: number | null): string {
  if (typeof tabId === 'number' && tabId > 0) {
    return `${DRAFT_PREFIX}t${tabId}.${key}`
  }
  return `${DRAFT_PREFIX}${key}`
}

/**
 * 本页面已改、但还没确认落盘的草稿键（防抖还在窗口内，或写入正在飞行中）。
 * 挂载时的异步读取必须避开它们：卸载会清掉防抖定时器，会话存储里可能仍是旧值，
 * 直接套用会把内存里刚改好的新值覆盖回去 —— 表现为「刚切的 tab / 刚输入的内容被还原」。
 */
const locallyDirty = new Set<string>()

/**
 * 读取某个草稿（优先内存缓存，回退会话存储）。
 * 供「写入前先保留用户其它偏好」的场景使用（如智能解析送数据给 JSON 工具时保留其缩进/排序设置）。
 */
export async function getDraftValue<T>(key: string, tabId?: number | null): Promise<T | null> {
  const fullKey = getScopedDraftKey(key, tabId)
  if (memoryCache.has(fullKey)) return memoryCache.get(fullKey) as T
  return storageGet<T>('session', fullKey)
}

/**
 * 从外部写入某个草稿（如智能解析的「在 XX 工具中打开」）。
 * 必须**同时**更新内存缓存与会话存储：`useToolDraft` 的初始状态优先取内存缓存，
 * 只写存储会让同一会话内先前用过该工具的用户看到一帧旧值（甚至误以为没带过去）。
 */
export async function setDraftValue<T>(
  key: string,
  value: T,
  tabId?: number | null,
): Promise<void> {
  const fullKey = getScopedDraftKey(key, tabId)
  memoryCache.set(fullKey, value)
  locallyDirty.add(fullKey)
  await storageSet('session', fullKey, value)
  locallyDirty.delete(fullKey)
}

/**
 * 工具草稿状态持久化 Hook（基于浏览器会话存储，关抽屉/刷页面/切换侧边栏不丢失，关标签页或关浏览器自动清空）
 * - 结合内存同步缓存：切换 Tab 或重新挂载时零延迟、无白屏/闪烁
 * - 支持 TabScopeContext：标签页级工作区隔离，不同标签页（如 a.com 与 b.com）互不干扰
 * - 防抖自动同步到 chrome.storage.session
 * - 提供 clearDraft 一键清空重置
 */
export function useToolDraft<T>(
  key: string,
  initialValue: T,
): [T, (val: T | ((prev: T) => T)) => void, () => void, boolean] {
  const tabId = useContext(TabScopeContext)
  const fullKey = getScopedDraftKey(key, tabId)
  const [value, setValue] = useState<T>(() => {
    if (memoryCache.has(fullKey)) {
      return memoryCache.get(fullKey) as T
    }
    return initialValue
  })
  const [loaded, setLoaded] = useState(() => memoryCache.has(fullKey))
  const timerRef = useRef<number | undefined>(undefined)
  const isSelfUpdate = useRef(false)

  // 挂载时从会话存储异步读取（用于跨刷新或新标签页恢复）
  useEffect(() => {
    let alive = true
    void storageGet<T>('session', fullKey).then((saved) => {
      if (!alive) return
      // 本页面刚改过、还没确认落盘的值，不能被存储里的旧值覆盖
      if (saved !== null && saved !== undefined && !locallyDirty.has(fullKey)) {
        memoryCache.set(fullKey, saved)
        setValue(saved)
      } else if (!locallyDirty.has(fullKey)) {
        if (memoryCache.has(fullKey)) {
          setValue(memoryCache.get(fullKey) as T)
        } else {
          setValue(initialValue)
        }
      }
      setLoaded(true)
    })

    // 跨页面/跨侧边栏实时同步
    const onStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'session' || !changes[fullKey]) return
      if (isSelfUpdate.current) {
        isSelfUpdate.current = false
        return
      }
      const next = changes[fullKey].newValue as T | undefined
      if (next !== undefined && next !== null) {
        memoryCache.set(fullKey, next)
        setValue(next)
      } else {
        memoryCache.delete(fullKey)
        setValue(initialValue)
      }
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onStorageChange)
    }

    return () => {
      alive = false
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(onStorageChange)
      }
      window.clearTimeout(timerRef.current)
      // 卸载（切走工具 / 关抽屉）时把防抖窗口里的改动立即落盘：
      // 只清定时器会让这次改动停留在内存缓存里、会话存储仍是旧值，
      // 既让其它页面读不到，又会被重挂载后的首个异步读取覆盖回去。
      if (timerRef.current !== undefined) {
        timerRef.current = undefined
        const pending = memoryCache.get(fullKey)
        if (pending !== undefined) {
          void storageSet('session', fullKey, pending).finally(() => locallyDirty.delete(fullKey))
        }
      }
    }
  }, [fullKey, initialValue])

  const setDraft = useCallback(
    (action: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof action === 'function' ? (action as (p: T) => T)(prev) : action
        memoryCache.set(fullKey, next)
        locallyDirty.add(fullKey)
        window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => {
          timerRef.current = undefined
          isSelfUpdate.current = true
          void storageSet('session', fullKey, next).finally(() => locallyDirty.delete(fullKey))
        }, 200)
        return next
      })
    },
    [fullKey],
  )

  const clearDraft = useCallback(() => {
    window.clearTimeout(timerRef.current)
    timerRef.current = undefined
    memoryCache.delete(fullKey)
    locallyDirty.delete(fullKey)
    setValue(initialValue)
    void storageRemove('session', fullKey)
  }, [fullKey, initialValue])

  return [value, setDraft, clearDraft, loaded]
}
