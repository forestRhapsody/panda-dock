import { useEffect } from 'react'

import { useLocale } from '@/i18n/useLocale'
import ToolsApp from '@/tools/ToolsApp'
import { TabScopeContext } from '@/utils/draft'
import { useFontScale } from '@/utils/fontScale'
import { MSG_CLOSE_NATIVE_SIDE_PANEL, PORT_SIDEPANEL } from '@/utils/messages'
import { useTheme } from '@/utils/theme'

import './index.css'

/**
 * 浏览器原生侧边栏(Side Panel)页面：定位为浏览器全局常驻工具箱。
 * - 数据跨标签页全局共享，不随 Tab 切换而变动；
 * - 关闭 ToolsApp 自身的 header（showHeader=false），避免与 Chrome 自带 header 重叠；
 * - 挂载时建立 panda-dock-sidepanel Port 长连接，与网页抽屉保持互斥。
 */
export default function SidePanelPage() {
  useLocale()
  useFontScale()
  useTheme()

  useEffect(() => {
    let port: chrome.runtime.Port | null = null
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
        port = chrome.runtime.connect({ name: PORT_SIDEPANEL })
        port.onMessage.addListener((msg: unknown) => {
          if ((msg as { action?: string })?.action === MSG_CLOSE_NATIVE_SIDE_PANEL) {
            window.close()
          }
        })
        // 上报当前窗口 ID，供 background 进行窗口级侧边栏开闭状态追踪（抽屉互斥用）
        chrome.windows?.getCurrent?.((win) => {
          if (win?.id != null && port) {
            port.postMessage({ type: 'SIDE_PANEL_INIT', windowId: win.id })
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
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(onRuntimeMessage)
    }

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
      <TabScopeContext.Provider value={null}>
        <ToolsApp showHeader={false} />
      </TabScopeContext.Provider>
    </div>
  )
}
