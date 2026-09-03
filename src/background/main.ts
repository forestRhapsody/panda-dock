import { MSG_OPEN_NATIVE_SIDE_PANEL } from '@/utils/messages'

/**
 * Background Service Worker：
 * content script（悬浮球）请求唤起浏览器原生侧边栏时的中转。
 * 注意：sidePanel.open 需要用户手势，content→SW 的消息会丢失手势，
 * 因此在部分 Chrome 版本上可能被拒绝 —— 失败时 content 会自动回退到网页内抽屉。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message as { action?: string } | undefined)?.action !== MSG_OPEN_NATIVE_SIDE_PANEL) {
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
