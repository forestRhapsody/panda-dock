import { afterEach, describe, expect, it, vi } from 'vitest'

import { MSG_OPEN_SHORTCUTS } from './messages'
import {
  formatShortcutForDisplay,
  getDetectShortcut,
  getToolkitShortcut,
  openShortcutsPage,
} from './shortcuts'

/**
 * 快捷键在 UI 上要展示给用户，所以任何取不到真实配置的情况（未配置、API 抛错、无 chrome）
 * 都必须回退到与 manifest 一致的默认值，而不是显示空白或抛异常。
 *
 * 平台判定靠 navigator，涉及平台差异的用例统一用 `vi.stubGlobal('navigator', …)`，
 * 并在 afterEach 用 `vi.unstubAllGlobals()` 还原，避免污染其它用例。
 */

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

function stubCommands(getAll: () => Promise<unknown>) {
  globalWithChrome.chrome = { commands: { getAll } }
}

/** 只替换 navigator，模拟不同操作系统 */
function stubNavigator(nav: unknown) {
  vi.stubGlobal('navigator', nav)
}

afterEach(() => {
  delete globalWithChrome.chrome
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getToolkitShortcut / getDetectShortcut 读取命令配置', () => {
  it('命中 toggle-toolkit 时返回用户配置的快捷键', async () => {
    stubCommands(async () => [
      { name: 'toggle-detect', shortcut: 'Alt+Shift+S' },
      { name: 'toggle-toolkit', shortcut: 'Ctrl+Shift+K' },
    ])
    await expect(getToolkitShortcut()).resolves.toBe('Ctrl+Shift+K')
  })

  it('命中 toggle-detect 时返回用户配置的快捷键', async () => {
    stubCommands(async () => [
      { name: 'toggle-toolkit', shortcut: 'Ctrl+Shift+K' },
      { name: 'toggle-detect', shortcut: 'Ctrl+Shift+L' },
    ])
    await expect(getDetectShortcut()).resolves.toBe('Ctrl+Shift+L')
  })

  it.each([
    ['空串', ''],
    ['undefined', undefined],
  ])('命令存在但快捷键为 %s 时回退默认值（用户没绑键）', async (_label, shortcut) => {
    stubCommands(async () => [
      { name: 'toggle-toolkit', shortcut },
      { name: 'toggle-detect', shortcut },
    ])
    await expect(getToolkitShortcut()).resolves.toBe('Alt+Shift+D')
    await expect(getDetectShortcut()).resolves.toBe('Alt+Shift+S')
  })

  it('没有匹配的命令名时回退默认值', async () => {
    stubCommands(async () => [{ name: 'some-other-command', shortcut: 'Ctrl+M' }])
    await expect(getToolkitShortcut()).resolves.toBe('Alt+Shift+D')
    await expect(getDetectShortcut()).resolves.toBe('Alt+Shift+S')
  })

  it('getAll 抛错时回退默认值，不把异常抛给 UI', async () => {
    stubCommands(async () => {
      throw new Error('commands API unavailable')
    })
    await expect(getToolkitShortcut()).resolves.toBe('Alt+Shift+D')
    await expect(getDetectShortcut()).resolves.toBe('Alt+Shift+S')
  })

  it('getAll 返回非数组（旧内核或桩异常）时同样回退默认值', async () => {
    stubCommands(async () => undefined)
    await expect(getToolkitShortcut()).resolves.toBe('Alt+Shift+D')
    await expect(getDetectShortcut()).resolves.toBe('Alt+Shift+S')
  })

  it('无 chrome（pnpm dev 预览）时回退默认值', async () => {
    await expect(getToolkitShortcut()).resolves.toBe('Alt+Shift+D')
    await expect(getDetectShortcut()).resolves.toBe('Alt+Shift+S')
  })

  it('chrome 存在但没有 commands API 时回退默认值，不裸调', async () => {
    globalWithChrome.chrome = { runtime: { id: 'abcdefghijklmnop' } }
    await expect(getToolkitShortcut()).resolves.toBe('Alt+Shift+D')
    await expect(getDetectShortcut()).resolves.toBe('Alt+Shift+S')
  })
})

describe('openShortcutsPage 的打开路径', () => {
  it('有 chrome.tabs 时开 chrome://extensions/shortcuts 并返回 true', async () => {
    const create = vi.fn(async () => ({}))
    const sendMessage = vi.fn(async () => true)
    globalWithChrome.chrome = { tabs: { create }, runtime: { sendMessage } }
    await expect(openShortcutsPage()).resolves.toBe(true)
    expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('没有 chrome.tabs（content script）时经 background 的 MSG_OPEN_SHORTCUTS', async () => {
    const sendMessage = vi.fn(async () => true)
    globalWithChrome.chrome = { runtime: { sendMessage } }
    await expect(openShortcutsPage()).resolves.toBe(true)
    expect(sendMessage).toHaveBeenCalledWith({ action: MSG_OPEN_SHORTCUTS })
  })

  it('background 回 false 时返回 false（失败要能被 UI 感知）', async () => {
    globalWithChrome.chrome = { runtime: { sendMessage: async () => false } }
    await expect(openShortcutsPage()).resolves.toBe(false)
  })

  it('background 回真值但非布尔时归一化为 true', async () => {
    globalWithChrome.chrome = { runtime: { sendMessage: async () => 1 } }
    await expect(openShortcutsPage()).resolves.toBe(true)
  })

  it('background 抛错时返回 false，不把异常抛给 UI', async () => {
    globalWithChrome.chrome = {
      runtime: {
        sendMessage: async () => {
          throw new Error('Could not establish connection')
        },
      },
    }
    await expect(openShortcutsPage()).resolves.toBe(false)
  })

  it('chrome 存在但 tabs / runtime 都不可用时返回 false', async () => {
    globalWithChrome.chrome = {}
    await expect(openShortcutsPage()).resolves.toBe(false)
  })

  it('无 chrome 时返回 false', async () => {
    await expect(openShortcutsPage()).resolves.toBe(false)
  })

  it('tabs.create 抛错时回退到 background（与 openOptionsPage 同一套降级顺序）', async () => {
    const create = vi.fn(async () => {
      throw new Error('Cannot access a chrome:// URL')
    })
    const sendMessage = vi.fn(async () => true)
    globalWithChrome.chrome = { tabs: { create }, runtime: { sendMessage } }
    await expect(openShortcutsPage()).resolves.toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith({ action: MSG_OPEN_SHORTCUTS })
  })

  it('tabs.create 抛错且 background 也失败时返回 false', async () => {
    const create = vi.fn(async () => {
      throw new Error('nope')
    })
    const sendMessage = vi.fn(async () => false)
    globalWithChrome.chrome = { tabs: { create }, runtime: { sendMessage } }
    await expect(openShortcutsPage()).resolves.toBe(false)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('formatShortcutForDisplay 的平台差异', () => {
  it('mac 平台把修饰键换成符号并用空格连接', () => {
    stubNavigator({ platform: 'MacIntel', userAgent: '' })
    expect(formatShortcutForDisplay('Alt+Shift+D')).toBe('⌥ ⇧ D')
  })

  it.each([
    ['Ctrl', '⌃'],
    ['Control', '⌃'],
    ['Cmd', '⌘'],
    ['Command', '⌘'],
    ['Meta', '⌘'],
    ['Option', '⌥'],
    ['Alt', '⌥'],
    ['Shift', '⇧'],
  ])('mac 识别修饰键 %s → %s', (key, symbol) => {
    stubNavigator({ platform: 'MacIntel', userAgent: '' })
    expect(formatShortcutForDisplay(`${key}+K`)).toBe(`${symbol} K`)
  })

  it('mac 下修饰键大小写不敏感，非修饰键统一转大写', () => {
    stubNavigator({ platform: 'MacIntel', userAgent: '' })
    expect(formatShortcutForDisplay('alt+shift+d')).toBe('⌥ ⇧ D')
  })

  it('mac 下忽略每个部件两侧的多余空格', () => {
    stubNavigator({ platform: 'MacIntel', userAgent: '' })
    expect(formatShortcutForDisplay(' Alt + Shift + D ')).toBe('⌥ ⇧ D')
  })

  it('mac 下无法识别的键保持原样但转大写', () => {
    stubNavigator({ platform: 'MacIntel', userAgent: '' })
    expect(formatShortcutForDisplay('Alt+f5')).toBe('⌥ F5')
  })

  it('platform 为空时用 userAgent 里的 Macintosh 判定 mac', () => {
    stubNavigator({
      platform: '',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    })
    expect(formatShortcutForDisplay('Cmd+S')).toBe('⌘ S')
  })

  it('platform 为空时用 userAgentData.platform 判定 mac（新版 Chromium）', () => {
    stubNavigator({ platform: '', userAgent: '', userAgentData: { platform: 'macOS' } })
    expect(formatShortcutForDisplay('Cmd+S')).toBe('⌘ S')
  })

  it('iPhone / iPad 也按 mac 处理', () => {
    stubNavigator({ platform: 'iPhone', userAgent: '' })
    expect(formatShortcutForDisplay('Cmd+S')).toBe('⌘ S')
  })

  it('非 mac 平台保留原键名并用 " + " 连接', () => {
    stubNavigator({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })
    expect(formatShortcutForDisplay('Alt+Shift+D')).toBe('Alt + Shift + D')
  })

  it('非 mac 不做符号化、也不改大小写', () => {
    stubNavigator({ platform: 'Win32', userAgent: '' })
    expect(formatShortcutForDisplay('alt+shift+d')).toBe('alt + shift + d')
    expect(formatShortcutForDisplay('Meta+Option+K')).toBe('Meta + Option + K')
  })

  it('非 mac 同样去掉部件两侧空格', () => {
    stubNavigator({ platform: 'Win32', userAgent: '' })
    expect(formatShortcutForDisplay(' Alt + Shift + D ')).toBe('Alt + Shift + D')
  })

  it('空串直接返回空串，与平台无关', () => {
    stubNavigator({ platform: 'MacIntel', userAgent: '' })
    expect(formatShortcutForDisplay('')).toBe('')
    stubNavigator({ platform: 'Win32', userAgent: '' })
    expect(formatShortcutForDisplay('')).toBe('')
  })

  it('只有空白字符时返回空串（trim 后没有可用部件）', () => {
    stubNavigator({ platform: 'Win32', userAgent: '' })
    expect(formatShortcutForDisplay('   ')).toBe('')
  })

  it('navigator 不存在（纯 Node / SSR）时按非 mac 处理，不抛错', () => {
    stubNavigator(undefined)
    expect(formatShortcutForDisplay('Alt+Shift+D')).toBe('Alt + Shift + D')
  })
})
