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
    chrome.runtime?.onMessage?.addListener(onRuntimeMessage)

    const onKeyDown = (e: KeyboardEvent) => {
      // 侧边栏获得焦点时：按 Escape 或 Alt+Shift+D 均可立即关闭收回
      if (e.key === 'Escape') {
        window.close()
        return
      }
      if ((e.altKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault()
        window.close()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      chrome.runtime?.onMessage?.removeListener(onRuntimeMessage)
      window.removeEventListener('keydown', onKeyDown)
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
