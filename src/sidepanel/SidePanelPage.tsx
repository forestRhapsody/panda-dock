import ToolsApp from '@/tools/ToolsApp'
import { isExtension } from '@/utils/env'
import { closeNativeSidePanel } from '@/utils/sidePanel'

import './index.css'

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
            <button
              type='button'
              className='sp__btn'
              title='收起侧边栏'
              onClick={() => void closeNativeSidePanel()}
            >
              收起
            </button>
          )
        }
      />
    </div>
  )
}
