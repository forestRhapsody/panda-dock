import i18n from '@/i18n'
import { isExtension } from '@/utils/env'
import {
  isErrorCode,
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
import type { ErrorCode } from '@/utils/messages'

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
  /** 是否为 host-only Cookie（为 false 表示 Cookie 的 Domain 覆盖其子域，即原始 domain 带前导点） */
  hostOnly: boolean
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

/**
 * 错误码 → i18n key。必须与 `utils/messages.ts` 的 ERROR_CODES 一一对应，
 * 且对应 key 必须在 zh/en 语言包中同时存在（由 storage.test.ts 断言兜底）。
 */
const ERROR_KEYS: Record<ErrorCode, string> = {
  ERR_COOKIE_NO_PAGE_URL: 'tool.storage.errorCookieNoPageUrl',
  ERR_COOKIE_MISSING_PARAM: 'tool.storage.errorCookieMissingParam',
  ERR_COOKIE_REMOVE_FAILED: 'tool.storage.errorCookieDelete',
  ERR_COOKIE_SET_FAILED: 'tool.storage.errorCookieSetFailed',
  ERR_COOKIE_EMPTY_PAYLOAD: 'tool.storage.errorCookieEmptyPayload',
  ERR_NO_TARGET_URL: 'tool.storage.errorNoTargetUrl',
  ERR_UNEXPECTED: 'tool.storage.errorUnexpected',
}

/**
 * 支持 `detail` 插值的错误码 → 「带详情」文案 key。
 * 这些 key 的模板里含 `{{detail}}`；基础 key（ERROR_KEYS）不含占位符，
 * 因此**没有 detail 时必须回落到基础 key**，否则用户会看到字面量 `{{detail}}`（历史缺陷）。
 */
const ERROR_DETAIL_KEYS: Partial<Record<ErrorCode, string>> = {
  ERR_COOKIE_SET_FAILED: 'tool.storage.errorCookieSetFailedDetail',
  ERR_UNEXPECTED: 'tool.storage.errorUnexpectedDetail',
}

/** 供测试断言映射完备性（见 storage.test.ts） */
export function storageErrorKey(code: ErrorCode): string {
  return ERROR_KEYS[code]
}

/** 「带详情」文案 key（该码没有详情版本时返回 undefined）；供测试断言映射完备性 */
export function storageErrorDetailKey(code: ErrorCode): string | undefined {
  return ERROR_DETAIL_KEYS[code]
}

/**
 * 把 background 的失败响应转成当前语言的文案。
 * - 新版 background 回 `{ ok:false, code, detail? }` → 按 code 映射；
 * - 升级过渡期（扩展页已更新、Service Worker 仍是旧版）回的是 error 句子 → 原样透传，不丢信息；
 * - 两者都没有 → 使用调用方给的兜底 key。
 */
export function resolveStorageError(res: unknown, fallbackKey: string): string {
  const payload = res as { code?: unknown; detail?: unknown; error?: unknown } | null | undefined
  if (isErrorCode(payload?.code)) {
    const detail = typeof payload?.detail === 'string' && payload.detail ? payload.detail : ''
    const detailKey = ERROR_DETAIL_KEYS[payload.code]
    // 只有拿得到 detail 且该码登记了带详情模板时才插值；否则用不含占位符的基础文案
    if (detail && detailKey) return i18n.t(detailKey, { detail })
    return i18n.t(ERROR_KEYS[payload.code])
  }
  if (typeof payload?.error === 'string' && payload.error) return payload.error
  return i18n.t(fallbackKey)
}

const MAX_KEYS = 2000
const MAX_VALUE_CHARS = 8000

/** 是否运行在网页上下文（drawer/预览页可直接读写页面存储；侧边栏等扩展页不可） */
export function isPageContext(): boolean {
  return /^https?:$/.test(window.location.protocol)
}

function areaStorage(area: WebStorageArea): Storage {
  return area === 'session' ? window.sessionStorage : window.localStorage
}

function buildSnapshot(area: WebStorageArea): StorageSnapshot {
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
    // 直接返回失败结果：这里若 `throw`，会被本函数自己的 catch 吞掉并统一变成 errorUnreadable，
    // 使 errorNoActiveTab 成为永远不会出现在界面上的死文案
    if (tab?.id == null) return { ok: false, error: i18n.t('tool.storage.errorNoActiveTab') }
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

/** 去除 Cookie domain 的 RFC 6265 遗留前导点（".example.com" → "example.com"）；
 *  该点的语义是「Cookie 覆盖其子域」，由 `hostOnly` 字段承载，展示层不再展示这个点 */
export function bareCookieDomain(domain: string): string {
  return domain.startsWith('.') ? domain.slice(1) : domain
}

export function getCookieUrl(
  cookie: Pick<CookieEntry, 'domain' | 'path' | 'secure'>,
  fallbackUrl?: string,
): string {
  let domain = bareCookieDomain(cookie.domain)
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
            hostOnly: false,
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
            hostOnly: true,
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
      return { ok: false, error: resolveStorageError(res, 'tool.storage.errorUnreadable') }
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
    return { ok: false, error: resolveStorageError(res, 'tool.storage.errorCookieDelete') }
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
    return { ok: false, error: resolveStorageError(res, 'tool.storage.errorCookieClear') }
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
    return { ok: false, error: resolveStorageError(res, 'tool.storage.errorCookieSave') }
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
