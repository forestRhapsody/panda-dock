import {
  MSG_STORAGE_CLEAR,
  MSG_STORAGE_READ,
  MSG_STORAGE_REMOVE,
  MSG_STORAGE_SET,
} from '@/utils/messages'

export type StorageArea = 'local' | 'session'

export interface StorageEntry {
  key: string
  /** 值的字节大小（UTF-8） */
  size: number
  value: string
  truncated: boolean
}

export interface StorageSnapshot {
  origin: string
  area: StorageArea
  entries: StorageEntry[]
  totalCount: number
  /** 条目过多只列出了前一部分 */
  listTruncated: boolean
}

export type StorageResult = { ok: true; data: StorageSnapshot } | { ok: false; error: string }

export type SimpleResult = { ok: true } | { ok: false; error: string }

const MAX_KEYS = 2000
const MAX_VALUE_CHARS = 8000

/** 是否运行在网页上下文（drawer/预览页可直接读写页面存储；侧边栏等扩展页不可） */
export function isPageContext(): boolean {
  return /^https?:$/.test(window.location.protocol)
}

function areaStorage(area: StorageArea): Storage {
  return area === 'session' ? window.sessionStorage : window.localStorage
}

export function buildSnapshot(area: StorageArea): StorageSnapshot {
  const store = areaStorage(area)
  const origin = window.location.origin
  const totalCount = store.length
  const count = Math.min(totalCount, MAX_KEYS)
  const entries: StorageEntry[] = []
  const encoder = new TextEncoder()

  for (let i = 0; i < count; i++) {
    const key = store.key(i)
    if (key == null) continue
    const value = store.getItem(key) ?? ''
    entries.push({
      key,
      size: encoder.encode(value).length,
      truncated: value.length > MAX_VALUE_CHARS,
      value: value.slice(0, MAX_VALUE_CHARS),
    })
  }
  return { origin, area, entries, totalCount, listTruncated: totalCount > MAX_KEYS }
}

/** 扩展页面 → 当前活动标签页的 content script 发起请求 */
async function askActiveTab(message: unknown): Promise<StorageResult | SimpleResult> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id == null) throw new Error('找不到活动标签页')
    const res = await chrome.tabs.sendMessage(tab.id, message)
    if (res?.ok) return res
    return { ok: false, error: res?.error ?? '当前页面没有响应（可能未注入 content script）' }
  } catch {
    return { ok: false, error: '无法读取：当前标签页不是 http(s) 页面或尚未注入' }
  }
}

/** 列出某个存储区域的键值 */
export async function listStorage(area: StorageArea): Promise<StorageResult> {
  try {
    if (isPageContext()) return { ok: true, data: buildSnapshot(area) }
    return (await askActiveTab({ action: MSG_STORAGE_READ, area })) as StorageResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 删除某个 key */
export async function removeStorageKey(area: StorageArea, key: string): Promise<SimpleResult> {
  try {
    if (isPageContext()) {
      areaStorage(area).removeItem(key)
      return { ok: true }
    }
    return (await askActiveTab({ action: MSG_STORAGE_REMOVE, area, key })) as SimpleResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 写入/更新某个 key 的值 */
export async function setStorageValue(
  area: StorageArea,
  key: string,
  value: string,
): Promise<SimpleResult> {
  try {
    if (isPageContext()) {
      areaStorage(area).setItem(key, value)
      return { ok: true }
    }
    return (await askActiveTab({ action: MSG_STORAGE_SET, area, key, value })) as SimpleResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 清空某个存储区域 */
export async function clearStorageArea(area: StorageArea): Promise<SimpleResult> {
  try {
    if (isPageContext()) {
      areaStorage(area).clear()
      return { ok: true }
    }
    return (await askActiveTab({ action: MSG_STORAGE_CLEAR, area })) as SimpleResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * content script 侧的存储桥接监听（供原生侧边栏等扩展页面读取当前网页存储）。
 * 由 content/main.tsx 调用注册。
 */
export function installStorageBridge(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const action = (message as { action?: string } | undefined)?.action
    if (action === MSG_STORAGE_READ) {
      const area = (message as { area?: StorageArea }).area ?? 'local'
      try {
        sendResponse({ ok: true, data: buildSnapshot(area) })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return undefined
    }
    if (action === MSG_STORAGE_REMOVE) {
      const { area = 'local', key } = message as { area?: StorageArea; key?: string }
      if (!key) {
        sendResponse({ ok: false, error: '缺少 key' })
        return undefined
      }
      try {
        areaStorage(area).removeItem(key)
        sendResponse({ ok: true })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return undefined
    }
    if (action === MSG_STORAGE_SET) {
      const {
        area = 'local',
        key,
        value,
      } = message as {
        area?: StorageArea
        key?: string
        value?: string
      }
      if (!key) {
        sendResponse({ ok: false, error: '缺少 key' })
        return undefined
      }
      try {
        areaStorage(area).setItem(key, value ?? '')
        sendResponse({ ok: true })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return undefined
    }
    if (action === MSG_STORAGE_CLEAR) {
      const area = (message as { area?: StorageArea }).area ?? 'local'
      try {
        areaStorage(area).clear()
        sendResponse({ ok: true })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return undefined
    }
    return undefined
  })
}
