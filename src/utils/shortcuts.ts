import { MSG_OPEN_SHORTCUTS } from '@/utils/messages'

/** 读取当前扩展配置的工具箱全局唤起快捷键（若未配置或浏览器不支持则回退默认值） */
export async function getToolkitShortcut(): Promise<string> {
  try {
    if (typeof chrome !== 'undefined' && chrome.commands?.getAll) {
      const commands = await chrome.commands.getAll()
      const found = commands.find((c) => c.name === 'toggle-toolkit')
      if (found?.shortcut) return found.shortcut
    }
  } catch {
    // 忽略
  }
  return 'Alt+Shift+D'
}

/** 读取当前扩展配置的智能解析全局快捷键（若未配置或浏览器不支持则回退默认值） */
export async function getDetectShortcut(): Promise<string> {
  try {
    if (typeof chrome !== 'undefined' && chrome.commands?.getAll) {
      const commands = await chrome.commands.getAll()
      const found = commands.find((c) => c.name === 'toggle-detect')
      if (found?.shortcut) return found.shortcut
    }
  } catch {
    // 忽略
  }
  return 'Alt+Shift+S'
}

/** 打开 Chrome 扩展快捷键配置页面（chrome://extensions/shortcuts） */
export async function openShortcutsPage(): Promise<boolean> {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
      return true
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const res = (await chrome.runtime.sendMessage({ action: MSG_OPEN_SHORTCUTS })) as boolean
      return Boolean(res)
    }
  } catch {
    // 忽略
  }
  return false
}
