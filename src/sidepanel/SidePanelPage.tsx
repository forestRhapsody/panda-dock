import { useEffect, useState } from 'react'

import { useLocale } from '@/i18n/useLocale'
import ToolsApp from '@/tools/ToolsApp'
import { WindowScopeContext } from '@/utils/draft'
import { isExtension } from '@/utils/env'
import { useFontScale } from '@/utils/fontScale'
import { MSG_CLOSE_NATIVE_SIDE_PANEL, MSG_GET_WINDOW_ID } from '@/utils/messages'
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

  const inExt = isExtension()
  // 扩展环境下初始为 null，等待异步获取到真实 windowId 后才挂载 ToolsApp；
  // 避免首帧用 null 全局 key 脏读/回写上一个窗口的草稿，彻底杜绝跨窗口状态串扰。
  const [windowId, setWindowId] = useState<number | null>(() => (inExt ? null : 0))

  useEffect(() => {
    let alive = true
    let port: chrome.runtime.Port | null = null
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
        port = chrome.runtime.connect({ name: 'toolkit-sidepanel' })
        port.onMessage.addListener((msg: unknown) => {
          if ((msg as { action?: string })?.action === MSG_CLOSE_NATIVE_SIDE_PANEL) {
            window.close()
          }
        })
      }
    } catch {
      // 忽略
    }

    let resolved = false
    const reportWindow = (id: number) => {
      resolved = true
      setWindowId(id)
      if (port) {
        port.postMessage({ type: 'SIDE_PANEL_INIT', windowId: id })
      }
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.windows?.getCurrent) {
        const ret: unknown = chrome.windows.getCurrent((win) => {
          if (win?.id != null && alive && !resolved) {
            reportWindow(win.id)
          }
        })
        if (Boolean(ret) && typeof (ret as Promise<{ id?: number }>).then === 'function') {
          void (ret as Promise<{ id?: number }>)
            .then((win) => {
              if (win?.id != null && alive && !resolved) {
                reportWindow(win.id)
              }
            })
            .catch(() => {})
        }
      }
    } catch {
      // 忽略
    }

    void (async () => {
      if (!inExt) return
      // 若 60ms 内仍未通过 getCurrent 确定 windowId，向 background 请求备援
      await new Promise((r) => setTimeout(r, 60))
      if (!alive || resolved) return
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          const res = await chrome.runtime.sendMessage({ action: MSG_GET_WINDOW_ID })
          if (alive && !resolved && res?.ok && typeof res.data === 'number') {
            reportWindow(res.data)
          }
        } catch {
          // 忽略
        }
      }
      if (alive && !resolved) {
        setWindowId(0)
      }
    })()

    const onRuntimeMessage = (msg: unknown) => {
      if ((msg as { action?: string })?.action === MSG_CLOSE_NATIVE_SIDE_PANEL) {
        window.close()
      }
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(onRuntimeMessage)
    }

    return () => {
      alive = false
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage)
      }
      try {
        port?.disconnect()
      } catch {
        // 忽略
      }
    }
  }, [inExt])

  if (windowId === null) {
    return <div className='sp' />
  }

  return (
    <div className='sp'>
      <WindowScopeContext.Provider value={windowId > 0 ? windowId : null}>
        <ToolsApp key={windowId} showHeader={false} />
      </WindowScopeContext.Provider>
    </div>
  )
}
