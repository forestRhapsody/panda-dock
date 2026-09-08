import { useCallback, useEffect, useRef, useState } from 'react'

import { storageGet, storageRemove, storageSet } from '@/utils/env'

const DRAFT_PREFIX = 'toolkit.draft.'
const memoryCache = new Map<string, unknown>()

/**
 * 工具草稿状态持久化 Hook（基于浏览器会话存储，关抽屉/刷页面/切换侧边栏不丢失，关浏览器自动清空）
 * - 结合内存同步缓存：切换 Tab 或重新挂载时零延迟、无白屏/闪烁
 * - 防抖自动同步到 chrome.storage.session
 * - 提供 clearDraft 一键清空重置
 */
export function useToolDraft<T>(
  key: string,
  initialValue: T,
): [T, (val: T | ((prev: T) => T)) => void, () => void, boolean] {
  const fullKey = `${DRAFT_PREFIX}${key}`
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
      if (saved !== null && saved !== undefined) {
        memoryCache.set(fullKey, saved)
        setValue(saved)
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
    }
  }, [fullKey, initialValue])

  const setDraft = useCallback(
    (action: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof action === 'function' ? (action as (p: T) => T)(prev) : action
        memoryCache.set(fullKey, next)
        window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => {
          isSelfUpdate.current = true
          void storageSet('session', fullKey, next)
        }, 200)
        return next
      })
    },
    [fullKey],
  )

  const clearDraft = useCallback(() => {
    window.clearTimeout(timerRef.current)
    memoryCache.delete(fullKey)
    setValue(initialValue)
    void storageRemove('session', fullKey)
  }, [fullKey, initialValue])

  return [value, setDraft, clearDraft, loaded]
}
