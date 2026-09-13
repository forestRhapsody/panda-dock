import { useEffect, useState } from 'react'

import { useLocale } from '@/i18n/useLocale'
import ToolsApp from '@/tools/ToolsApp'
import { TabScopeContext } from '@/utils/draft'
import { isExtension } from '@/utils/env'
import { useFontScale } from '@/utils/fontScale'
import { MSG_CLOSE_NATIVE_SIDE_PANEL, MSG_GET_TAB_ID } from '@/utils/messages'
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
  // 扩展环境下初始为 null，等待异步获取到当前激活标签页的 tabId 后才挂载 ToolsApp；
  // 避免首帧用 null 全局 key 脏读/回写上一个 Tab 的草稿，彻底杜绝跨标签页状态串扰。
  const [activeTabId, setActiveTabId] = useState<number | null>(() => (inExt ? null : 0))

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

    let currentWindowId: number | null = null
    let resolved = false

    const resolveActiveTab = (winId: number) => {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        try {
          const ret: unknown = chrome.tabs.query({ active: true, windowId: winId }, (tabs) => {
            if (alive && tabs?.[0]?.id != null) {
              resolved = true
              setActiveTabId(tabs[0].id)
            } else if (alive && !resolved) {
              resolved = true
              setActiveTabId(winId)
            }
          })
          if (Boolean(ret) && typeof (ret as Promise<chrome.tabs.Tab[]>).then === 'function') {
            void (ret as Promise<chrome.tabs.Tab[]>)
              .then((tabs) => {
                if (alive && tabs?.[0]?.id != null) {
                  resolved = true
                  setActiveTabId(tabs[0].id)
                } else if (alive && !resolved) {
                  resolved = true
                  setActiveTabId(winId)
                }
              })
              .catch(() => {
                if (alive && !resolved) {
                  resolved = true
                  setActiveTabId(winId)
                }
              })
          }
        } catch {
          if (alive && !resolved) {
            resolved = true
            setActiveTabId(winId)
          }
        }
      } else {
        if (alive && !resolved) {
          resolved = true
          setActiveTabId(winId)
        }
      }
    }

    const reportWindow = (id: number) => {
      currentWindowId = id
      if (port) {
        port.postMessage({ type: 'SIDE_PANEL_INIT', windowId: id })
      }
      resolveActiveTab(id)
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
      // 若 60ms 内仍未确定 activeTabId，尝试备援查询
      await new Promise((r) => setTimeout(r, 60))
      if (!alive || resolved) return
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          const res = await chrome.runtime.sendMessage({ action: MSG_GET_TAB_ID })
          if (alive && !resolved && res?.ok && typeof res.data === 'number') {
            resolved = true
            setActiveTabId(res.data)
          }
        } catch {
          // 忽略
        }
      }
      if (alive && !resolved) {
        setActiveTabId(0)
      }
    })()

    // 监听当前窗口内的活跃标签页切换：切 Tab 时原生侧边栏自动无缝切到对应 Tab 的工作区
    const onTabActivated = (activeInfo: { tabId: number; windowId: number }) => {
      if (!alive) return
      if (currentWindowId == null || activeInfo.windowId === currentWindowId) {
        setActiveTabId(activeInfo.tabId)
      }
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(onTabActivated)
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
      alive = false
      if (typeof chrome !== 'undefined' && chrome.tabs?.onActivated) {
        chrome.tabs.onActivated.removeListener(onTabActivated)
      }
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

  if (activeTabId === null) {
    return <div className='sp' />
  }

  return (
    <div className='sp'>
      <TabScopeContext.Provider value={activeTabId > 0 ? activeTabId : null}>
        <ToolsApp key={activeTabId} showHeader={false} />
      </TabScopeContext.Provider>
    </div>
  )
}
