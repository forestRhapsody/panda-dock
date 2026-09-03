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
 * 主路径 chrome.tabs.create 开新标签（不依赖用户手势，popup 等扩展页稳定）；
 * 该 API 在部分侧边栏上下文会被拒绝，此时用标准 Web API window.open 兜底，确保总能打开。
 */
export async function openOptionsPage(): Promise<void> {
  if (typeof chrome === 'undefined') return
  const url = chrome.runtime.getURL('options.html')
  try {
    await chrome.tabs.create({ url })
    return
  } catch {
    // 侧边栏等上下文 tabs.create 被拒：用标准 Web API 直接打开（任意上下文可用）
    window.open(url, '_blank')
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
