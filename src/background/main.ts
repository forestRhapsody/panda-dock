import { MSG_OPEN_NATIVE_SIDE_PANEL, MSG_OPEN_OPTIONS } from '@/utils/messages'

/**
 * Background Service Worker：
 * - content script（悬浮球）请求唤起浏览器原生侧边栏时的中转。
 *   注意：sidePanel.open 需要用户手势，content→SW 的消息会丢失手势，
 *   因此在部分 Chrome 版本上可能被拒绝 —— 失败时 content 会自动回退到网页内抽屉。
 * - content script 请求打开扩展设置页（content script 没有 chrome.tabs，无法直接用
 *   chrome.tabs.create，且 window.open 打开扩展页会被 Chrome 以 ERR_BLOCKED_BY_CLIENT 拦截）
 *   → 改由 background 用 chrome.tabs.create 打开 options.html。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = (message as { action?: string } | undefined)?.action

  if (action === MSG_OPEN_OPTIONS) {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options.html') }).then(
      () => sendResponse(true),
      () => sendResponse(false),
    )
    return true // 保持消息通道以异步 sendResponse
  }

  if (action !== MSG_OPEN_NATIVE_SIDE_PANEL) {
    return undefined
  }

  const windowId = sender?.tab?.windowId
  if (windowId == null) {
    sendResponse(false)
    return undefined
  }

  void chrome.sidePanel.open({ windowId }).then(
    () => sendResponse(true),
    () => sendResponse(false),
  )
  return true // 保持消息通道以异步 sendResponse
})
