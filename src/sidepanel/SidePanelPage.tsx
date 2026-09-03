import ToolsApp from '@/tools/ToolsApp'
import { isExtension } from '@/utils/env'
import { MSG_TOGGLE_DRAWER } from '@/utils/messages'
import { closeNativeSidePanel } from '@/utils/sidePanel'

import './index.css'

/** 向当前活动标签页的 content script 发送「切换网页内抽屉」消息 */
async function toggleDrawerInActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id == null) return
    await chrome.tabs.sendMessage(tab.id, { action: MSG_TOGGLE_DRAWER })
  } catch {
    // 当前页面未注入 content script（如 chrome:// 页面）时静默失败
  }
}

/**
 * 浏览器原生侧边栏(Side Panel)页面。
 * 内容与网页内抽屉共用同一套 <ToolsApp/> 工具箱。
 */
export default function SidePanelPage() {
  const inExt = isExtension()

  return (
    <div className='sp'>
      <ToolsApp
        headerActions={
          inExt && (
            <>
              <button
                type='button'
                className='sp__btn'
                title='把工具箱以抽屉形式显示在当前网页右侧'
                onClick={() => void toggleDrawerInActiveTab()}
              >
                在网页中打开
              </button>
              <button
                type='button'
                className='sp__btn'
                title='收起侧边栏'
                onClick={() => void closeNativeSidePanel()}
              >
                收起
              </button>
            </>
          )
        }
      />
    </div>
  )
}
