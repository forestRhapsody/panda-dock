import { MSG_GET_PAGE_URL } from '@/utils/messages'

/**
 * 取「当前网页」的 URL：
 * - 页面上下文（网页内抽屉 / 预览页）：直接 `window.location.href`。
 * - 扩展页面（原生侧边栏等）：经 content script 取当前活动标签页的地址。
 *   （侧边栏自身的 location 是 sidepanel.html，所以必须走 content 桥接；读 tab.url
 *    需要 `tabs` 权限，为不加权限改走消息。）取不到返回 null。
 */
export async function getCurrentPageUrl(): Promise<string | null> {
  // 已注入 content script 的页面（http/https 及抽屉所在页）
  if (/^https?:$/.test(window.location.protocol)) {
    return window.location.href
  }
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.tabs?.sendMessage)
      return null
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id == null) return null
    const res = (await chrome.tabs.sendMessage(tab.id, {
      action: MSG_GET_PAGE_URL,
    })) as { ok?: boolean; url?: string } | undefined
    return res?.ok ? (res.url ?? null) : null
  } catch {
    return null
  }
}
