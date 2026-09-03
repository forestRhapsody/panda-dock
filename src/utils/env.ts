import { MSG_OPEN_OPTIONS } from '@/utils/messages'

/**
 * 扩展环境相关的小工具。
 * 所有对 chrome.* API 的访问都做了降级保护：
 * 在普通浏览器（`pnpm dev` 预览）里 chrome 不存在时也能安全渲染。
 */

/** 当前是否运行在真实扩展环境（popup / options / content script） */
export function isExtension(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)
}

/** 扩展版本号，浏览器预览时返回占位值 */
export function extVersion(): string {
  if (typeof chrome === 'undefined') return '0.2.0'
  try {
    return chrome.runtime.getManifest().version ?? '0.2.0'
  } catch {
    return '0.2.0'
  }
}

/**
 * 打开扩展设置页（options.html）。
 * 扩展页面（popup/options/sidepanel）有 chrome.tabs：直接用 chrome.tabs.create 开新标签。
 * content script（抽屉）没有 chrome.tabs，且 window.open 打开扩展页会被 Chrome 以
 * ERR_BLOCKED_BY_CLIENT 拦截 —— 改为经 background（MSG_OPEN_OPTIONS）打开。
 */
export async function openOptionsPage(): Promise<void> {
  if (typeof chrome === 'undefined') return
  const url = chrome.runtime.getURL('options.html')

  if (typeof chrome.tabs?.create === 'function') {
    try {
      await chrome.tabs.create({ url })
      return
    } catch {
      // 落到 background
    }
  }

  // content script 或 tabs.create 不可用：经 background 打开
  try {
    const ok = await chrome.runtime.sendMessage({ action: MSG_OPEN_OPTIONS })
    if (ok === true) return
  } catch {
    // 落到最后兜底
  }
  try {
    window.open(url, '_blank')
  } catch {
    // 忽略
  }
}

/** 读取扩展本地/同步存储，非扩展环境返回 null */
export async function storageGet<T>(area: 'local' | 'sync', key: string): Promise<T | null> {
  if (typeof chrome === 'undefined') return null
  try {
    const result = await chrome.storage[area].get(key)
    return (result[key] as T | undefined) ?? null
  } catch {
    return null
  }
}

/** 写入扩展本地/同步存储，返回是否成功 */
export async function storageSet(
  area: 'local' | 'sync',
  key: string,
  value: unknown,
): Promise<boolean> {
  if (typeof chrome === 'undefined') return false
  try {
    await chrome.storage[area].set({ [key]: value })
    return true
  } catch {
    return false
  }
}
