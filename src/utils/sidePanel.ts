/**
 * 原生侧边栏(Side Panel)操作 —— 只能在扩展页面（Popup/Options/SidePanel 页）中调用，
 * 需要用户手势且能拿到当前 windowId。
 */

/** 在侧边栏调用方所在的窗口打开原生侧边栏 */
export async function openNativeSidePanel(): Promise<boolean> {
  try {
    if (typeof chrome === 'undefined' || !chrome.windows?.getCurrent || !('sidePanel' in chrome))
      return false
    const win = await chrome.windows.getCurrent()
    if (win.id == null) return false
    await chrome.sidePanel.open({ windowId: win.id })
    return true
  } catch {
    return false
  }
}

/** 关闭侧边栏调用方所在窗口的原生侧边栏（Chrome 141+ 支持） */
export async function closeNativeSidePanel(): Promise<boolean> {
  try {
    if (typeof chrome === 'undefined' || !chrome.windows?.getCurrent || !('sidePanel' in chrome))
      return false
    if (typeof chrome.sidePanel.close !== 'function') return false
    const win = await chrome.windows.getCurrent()
    if (win.id == null) return false
    await chrome.sidePanel.close({ windowId: win.id })
    return true
  } catch {
    return false
  }
}
