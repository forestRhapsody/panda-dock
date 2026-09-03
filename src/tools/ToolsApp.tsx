import { useState } from 'react'
import type { ReactNode } from 'react'

import { extVersion, isExtension, openOptionsPage } from '@/utils/env'

import Base64Tool from './Base64Tool'
import JsonTool from './JsonTool'
import JwtTool from './JwtTool'
import StorageTool from './StorageTool'
import TimestampTool from './TimestampTool'

interface ToolsAppProps {
  /** 头部右侧的动作区（各宿主自定义：关闭、唤起抽屉等） */
  headerActions?: ReactNode
}

type ToolId = 'base64' | 'json' | 'jwt' | 'timestamp' | 'storage'

const TOOL_TABS: { id: ToolId; label: string }[] = [
  { id: 'base64', label: 'Base64' },
  { id: 'json', label: 'JSON' },
  { id: 'jwt', label: 'JWT' },
  { id: 'timestamp', label: '时间戳' },
  { id: 'storage', label: '本地存储' },
]

/**
 * 工具箱页面（共享 UI）：
 * 同一个页面被原生侧边栏(sidepanel.html)、网页内抽屉(content Drawer)复用。
 * 通过选项卡切换不同工具；新增工具只需在 TOOL_TABS 里登记并补一个渲染分支。
 */
export default function ToolsApp({ headerActions }: ToolsAppProps) {
  const inExt = isExtension()
  const [active, setActive] = useState<ToolId>('base64')

  return (
    <div className='tw'>
      <header className='tw__header'>
        <div className='tw__header-text'>
          <h1 className='tw__title'>🧰 工具箱</h1>
          <p className='tw__subtitle'>开发者常用小工具</p>
        </div>
        {headerActions && <div className='tw__header-actions'>{headerActions}</div>}
      </header>

      <nav className='tw-nav' role='tablist' aria-label='工具箱选项卡'>
        {TOOL_TABS.map((tab) => (
          <button
            key={tab.id}
            type='button'
            role='tab'
            aria-selected={active === tab.id}
            className={`tw-nav__btn${active === tab.id ? ' tw-nav__btn--on' : ''}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className='tw__body' role='tabpanel'>
        {active === 'base64' && <Base64Tool />}
        {active === 'json' && <JsonTool />}
        {active === 'jwt' && <JwtTool />}
        {active === 'timestamp' && <TimestampTool />}
        {active === 'storage' && <StorageTool />}
      </main>

      <footer className='tw__footer'>
        <span>v{extVersion()}</span>
        {inExt && (
          <button type='button' className='tw__link' onClick={openOptionsPage}>
            打开设置 →
          </button>
        )}
      </footer>
    </div>
  )
}
