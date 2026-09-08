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
    const onMessage = (msg: unknown) => {
      if ((msg as { action?: string })?.action === MSG_CLOSE_NATIVE_SIDE_PANEL) {
        window.close()
      }
    }
    chrome.runtime?.onMessage?.addListener(onMessage)
    return () => chrome.runtime?.onMessage?.removeListener(onMessage)
  }, [])

  return (
    <div className='sp'>
      <ToolsApp showHeader={false} />
    </div>
  )
}
