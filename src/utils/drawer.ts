import { MSG_CLOSE_DRAWER, MSG_OPEN_DRAWER } from '@/utils/messages'

/**
 * 让当前活动标签页打开「网页内抽屉」（经 content script 的 MSG_OPEN_DRAWER）。
 * 只能在扩展页面（Popup/Options/SidePanel）调用；
 * 当前标签页非 http(s) 或未注入 content script 时返回 false。
 *
 * 只把当前页面这一帧的抽屉设为打开，不改变 `settings.ballAction` —— 不影响点击悬浮球的默认行为。
 */
export async function openDrawerInActiveTab(): Promise<boolean> {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.tabs?.sendMessage)
      return false
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id == null) return false
    const res = (await chrome.tabs.sendMessage(tab.id, {
      action: MSG_OPEN_DRAWER,
    })) as { ok?: boolean } | undefined
    return res?.ok ?? true
  } catch {
    return false
  }
}

/**
 * 让当前活动标签页关闭「网页内抽屉」（经 content script 的 MSG_CLOSE_DRAWER）。
 * 用于与原生侧边栏互斥：打开侧边栏前先把当前页的抽屉关掉。
 * 纯尽力而为：目标页不可达/未注入时静默忽略，不当作错误。
 */
export async function closeDrawerInActiveTab(): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.tabs?.sendMessage) return
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id == null) return
    await chrome.tabs.sendMessage(tab.id, { action: MSG_CLOSE_DRAWER })
  } catch {
    // 目标页不可达或未注入：无需关闭，忽略
  }
}
