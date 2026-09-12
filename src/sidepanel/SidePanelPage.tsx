import { useEffect } from 'react'

import { useLocale } from '@/i18n/useLocale'
import ToolsApp from '@/tools/ToolsApp'
import { useFontScale } from '@/utils/fontScale'
import { MSG_CLOSE_NATIVE_SIDE_PANEL } from '@/utils/messages'
import { useTheme } from '@/utils/theme'

import './index.css'

/**
 * 浏览器原生侧边栏(Side Panel)页面。
 * Chrome 自带 header（扩展名 + 图标 + 关闭/固定按钮），为避免两个 header，
 * 这里关闭 <ToolsApp/> 自身的 header（showHeader=false）；内容与网页内抽屉仍共用 ToolsApp。
 */
export default function SidePanelPage() {
  useLocale()
  useFontScale()
  useTheme()

  useEffect(() => {
    let port: chrome.runtime.Port | null = null
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
        port = chrome.runtime.connect({ name: 'toolkit-sidepanel' })
        // 向 background 上报当前所在的 windowId，使 background 能精确定位该窗口的侧边栏状态
        chrome.windows?.getCurrent?.((win) => {
          if (win?.id != null && port) {
            port.postMessage({ type: 'SIDE_PANEL_INIT', windowId: win.id })
          }
        })
        port.onMessage.addListener((msg: unknown) => {
          if ((msg as { action?: string })?.action === MSG_CLOSE_NATIVE_SIDE_PANEL) {
            window.close()
          }
        })
      }
    } catch {
      // 忽略
    }

    const onRuntimeMessage = (msg: unknown) => {
      if ((msg as { action?: string })?.action === MSG_CLOSE_NATIVE_SIDE_PANEL) {
        window.close()
      }
    }
    // 与上方 Port 块保持一致：chrome.* 必须落在 typeof 守卫里（AGENTS §4 第 4 条）
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(onRuntimeMessage)
    }

    // 面板内**不再**自行处理全局键盘（原 Escape / Alt+Shift+D 分支已删除）：
    // - `window.close()` 对浏览器自有的侧边栏窗口是空操作，实测按 Escape 根本关不掉面板，
    //   单测只断言了「close 被调用」，所以一直是假绿；
    // - 更是误伤：全局 keydown 会让用户在 JSON 编辑、Cookie 弹窗、输入框里按 Escape（本意是取消当前编辑）
    //   时把整个面板关掉，与内层 ConfirmDialog 的 Escape 语义直接冲突。
    // 关闭职责归三处：Chrome 侧边栏自带的 X 按钮、用户配置的全局快捷键（Alt+Shift+D，由 background 的
    // chrome.commands.onCommand 处理）、以及抽屉互斥时的 MSG_CLOSE_NATIVE_SIDE_PANEL 消息。

    return () => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage)
      }
      try {
        port?.disconnect()
      } catch {
        // 忽略
      }
    }
  }, [])

  return (
    <div className='sp'>
      <ToolsApp showHeader={false} />
    </div>
  )
}
