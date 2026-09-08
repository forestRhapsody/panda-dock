import i18n from '@/i18n'
import { isExtension } from '@/utils/env'
import {
  MSG_COOKIE_CLEAR_ALL,
  MSG_COOKIE_GET_ALL,
  MSG_COOKIE_REMOVE,
  MSG_COOKIE_SET,
  MSG_GET_PAGE_URL,
  MSG_STORAGE_CLEAR,
  MSG_STORAGE_READ,
  MSG_STORAGE_REMOVE,
  MSG_STORAGE_SET,
} from '@/utils/messages'

import type { CookieSetDetails } from './cookieRaw'

export type WebStorageArea = 'local' | 'session'
export type StorageArea = WebStorageArea | 'cookie'

export interface StorageEntry {
  key: string
  /** 值的字节大小（UTF-8） */
  size: number
  value: string
  truncated: boolean
}

export interface StorageSnapshot {
  origin: string
  area: WebStorageArea
  entries: StorageEntry[]
  totalCount: number
  /** 条目过多只列出了前一部分 */
  listTruncated: boolean
}

export type StorageResult = { ok: true; data: StorageSnapshot } | { ok: false; error: string }

export interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified'
  session: boolean
  expirationDate?: number
  storeId?: string
  size: number
}

export interface CookieSnapshot {
  url: string
  origin: string
  cookies: CookieEntry[]
  totalCount: number
}

export type CookieResult = { ok: true; data: CookieSnapshot } | { ok: false; error: string }

export type SimpleResult = { ok: true } | { ok: false; error: string }

const MAX_KEYS = 2000
const MAX_VALUE_CHARS = 8000

/** 是否运行在网页上下文（drawer/预览页可直接读写页面存储；侧边栏等扩展页不可） */
export function isPageContext(): boolean {
  return /^https?:$/.test(window.location.protocol)
}

function areaStorage(area: WebStorageArea): Storage {
  return area === 'session' ? window.sessionStorage : window.localStorage
}

export function buildSnapshot(area: WebStorageArea): StorageSnapshot {
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
    if (tab?.id == null) throw new Error(i18n.t('tool.storage.errorNoActiveTab'))
    const res = await chrome.tabs.sendMessage(tab.id, message)
    if (res?.ok) return res
    return { ok: false, error: res?.error ?? i18n.t('tool.storage.errorNoResponse') }
  } catch {
    return { ok: false, error: i18n.t('tool.storage.errorUnreadable') }
  }
}

/** 列出某个存储区域的键值 */
export async function listStorage(area: WebStorageArea): Promise<StorageResult> {
  try {
    if (isPageContext()) return { ok: true, data: buildSnapshot(area) }
    return (await askActiveTab({ action: MSG_STORAGE_READ, area })) as StorageResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 删除某个 key */
export async function removeStorageKey(area: WebStorageArea, key: string): Promise<SimpleResult> {
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
  area: WebStorageArea,
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
export async function clearStorageArea(area: WebStorageArea): Promise<SimpleResult> {
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

export function getCookieUrl(
  cookie: Pick<CookieEntry, 'domain' | 'path' | 'secure'>,
  fallbackUrl?: string,
): string {
  let domain = cookie.domain
  if (domain.startsWith('.')) domain = domain.slice(1)
  if (!domain && fallbackUrl) {
    try {
      domain = new URL(fallbackUrl).hostname
    } catch {
      // 忽略
    }
  }
  const protocol = cookie.secure ? 'https:' : fallbackUrl?.startsWith('https:') ? 'https:' : 'http:'
  const path = cookie.path.startsWith('/') ? cookie.path : `/${cookie.path}`
  return `${protocol}//${domain}${path}`
}

/** 列出当前网页关联的所有 Cookie */
export async function listCookies(pageUrl?: string): Promise<CookieResult> {
  if (!isExtension()) {
    return {
      ok: true,
      data: {
        url: 'https://example.com',
        origin: 'https://example.com',
        cookies: [
          {
            name: 'session_id',
            value: 's%3A9F8aB3k1mQ4rZ2w8.dev_preview_session_mock',
            domain: '.example.com',
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
            session: false,
            expirationDate: Math.floor(Date.now() / 1000) + 86400 * 30,
            size: 48,
          },
          {
            name: 'theme_pref',
            value: 'system',
            domain: 'example.com',
            path: '/',
            secure: false,
            httpOnly: false,
            sameSite: 'lax',
            session: true,
            size: 16,
          },
        ],
        totalCount: 2,
      },
    }
  }

  try {
    const targetUrl = pageUrl || (isPageContext() ? window.location.href : undefined)
    const res = await chrome.runtime.sendMessage({
      action: MSG_COOKIE_GET_ALL,
      url: targetUrl,
    })
    if (!res?.ok) {
      return { ok: false, error: res?.error ?? i18n.t('tool.storage.errorUnreadable') }
    }
    const encoder = new TextEncoder()
    const rawCookies = (res.data?.cookies ?? []) as CookieEntry[]
    const cookies: CookieEntry[] = rawCookies.map((c) => ({
      ...c,
      size: encoder.encode(c.name + c.value).length,
    }))
    return {
      ok: true,
      data: {
        url: res.data.url,
        origin: res.data.origin,
        cookies,
        totalCount: cookies.length,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 删除指定 Cookie */
export async function removeCookie(cookie: CookieEntry, pageUrl: string): Promise<SimpleResult> {
  if (!isExtension()) return { ok: true }
  try {
    const cookieUrl = getCookieUrl(cookie, pageUrl)
    const res = await chrome.runtime.sendMessage({
      action: MSG_COOKIE_REMOVE,
      url: cookieUrl,
      name: cookie.name,
      storeId: cookie.storeId,
    })
    if (res?.ok) return { ok: true }
    return { ok: false, error: res?.error ?? i18n.t('tool.storage.errorCookieDelete') }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 清空当前网页的所有 Cookie */
export async function clearAllCookies(pageUrl: string): Promise<SimpleResult> {
  if (!isExtension()) return { ok: true }
  try {
    const res = await chrome.runtime.sendMessage({
      action: MSG_COOKIE_CLEAR_ALL,
      url: pageUrl,
    })
    if (res?.ok) return { ok: true }
    return { ok: false, error: res?.error ?? i18n.t('tool.storage.errorCookieClear') }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 写入或批量更新 Cookie */
export async function saveCookies(
  cookies: CookieSetDetails | CookieSetDetails[],
  pageUrl?: string,
  oldCookie?: CookieEntry,
): Promise<SimpleResult> {
  if (!isExtension()) return { ok: true }
  try {
    const list = Array.isArray(cookies) ? cookies : [cookies]
    const res = await chrome.runtime.sendMessage({
      action: MSG_COOKIE_SET,
      url: pageUrl,
      cookies: list,
      oldCookie: oldCookie
        ? {
            name: oldCookie.name,
            domain: oldCookie.domain,
            path: oldCookie.path,
            secure: oldCookie.secure,
            storeId: oldCookie.storeId,
          }
        : undefined,
    })
    if (res?.ok) return { ok: true }
    return { ok: false, error: res?.error ?? i18n.t('tool.storage.errorCookieSave') }
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
    if (action === MSG_GET_PAGE_URL) {
      try {
        sendResponse({ ok: true, url: window.location.href })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return undefined
    }
    if (action === MSG_STORAGE_READ) {
      const area: WebStorageArea =
        (message as { area?: WebStorageArea }).area === 'session' ? 'session' : 'local'
      try {
        sendResponse({ ok: true, data: buildSnapshot(area) })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return undefined
    }
    if (action === MSG_STORAGE_REMOVE) {
      const { area = 'local', key } = message as { area?: WebStorageArea; key?: string }
      if (!key) {
        sendResponse({ ok: false, error: i18n.t('tool.storage.errorMissingKey') })
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
        area?: WebStorageArea
        key?: string
        value?: string
      }
      if (!key) {
        sendResponse({ ok: false, error: i18n.t('tool.storage.errorMissingKey') })
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
      const area: WebStorageArea =
        (message as { area?: WebStorageArea }).area === 'session' ? 'session' : 'local'
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
