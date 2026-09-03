import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { extVersion, isExtension, openOptionsPage, storageGet } from '@/utils/env'

import Base64Tool from './Base64Tool'
import JsonTool from './JsonTool'
import JwtTool from './JwtTool'
import type { ToolId, ToolMeta } from './registry'
import { defaultToolLayout, normalizeToolLayout, visibleTools } from './registry'
import StorageTool from './StorageTool'
import TimestampTool from './TimestampTool'

interface ToolsAppProps {
  /** 头部右侧的动作区（各宿主自定义：关闭、唤起抽屉等） */
  headerActions?: ReactNode
}

const TOOL_COMPONENTS: Record<ToolId, () => ReactNode> = {
  base64: () => <Base64Tool />,
  json: () => <JsonTool />,
  jwt: () => <JwtTool />,
  timestamp: () => <TimestampTool />,
  storage: () => <StorageTool />,
}

const NAV_PAD = 8

/**
 * 工具箱页面（共享 UI）：
 * 同一个页面被原生侧边栏(sidepanel.html)、网页内抽屉(content Drawer)复用。
 * - 显示哪些工具、顺序如何，由 Options 里的配置（chrome.storage.sync）决定；
 * - 配置修改后通过 chrome.storage.onChanged 即时同步到已打开的页面；
 * - 选项卡超出容器宽度时自动滚动，并把激活项滚到可视区（参考 Vant Tabs）。
 */
export default function ToolsApp({ headerActions }: ToolsAppProps) {
  const inExt = isExtension()
  const [tools, setTools] = useState<ToolMeta[]>(() => visibleTools(defaultToolLayout()))
  const [active, setActive] = useState<ToolId>('base64')
  const navRef = useRef<HTMLElement>(null)
  const initializedRef = useRef(false)

  // 读取工具显示配置（浏览器预览时用默认值：全部显示）
  useEffect(() => {
    if (!inExt) return
    let alive = true
    const apply = (settings: { toolOrder?: unknown; toolEnabled?: unknown } | null | undefined) => {
      const layout = normalizeToolLayout(settings?.toolOrder, settings?.toolEnabled)
      const list = visibleTools(layout)
      setTools(list)
      // 打开时激活「配置顺序」里的第一个可见工具（而非硬编码 base64）；仅首次生效
      if (!initializedRef.current) {
        setActive(list[0]?.id ?? 'base64')
        initializedRef.current = true
      }
    }
    void storageGet<{ toolOrder?: unknown; toolEnabled?: unknown }>('sync', 'settings').then(
      (s) => {
        if (alive) apply(s)
      },
    )
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'sync' || changes.settings == null) return
      apply(changes.settings.newValue as { toolOrder?: unknown; toolEnabled?: unknown } | undefined)
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => {
      alive = false
      chrome.storage.onChanged.removeListener(onChange)
    }
  }, [inExt])

  // 当前激活项被隐藏时回退到第一个可见工具
  const activeVisible = tools.some((t) => t.id === active)
  useEffect(() => {
    if (!activeVisible) setActive(tools[0]?.id ?? 'base64')
  }, [activeVisible, tools])

  /** 把激活的选项卡滚动到可视区（容器内水平滚动，不影响页面滚动） */
  const revealActiveTab = useCallback((toolId: ToolId) => {
    const nav = navRef.current
    if (!nav) return
    const btn = nav.querySelector<HTMLButtonElement>(`.tw-nav__btn[data-tool="${toolId}"]`)
    if (!btn) return
    const navRect = nav.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    if (btnRect.left < navRect.left + NAV_PAD) {
      nav.scrollBy({ left: btnRect.left - navRect.left - NAV_PAD, behavior: 'smooth' })
    } else if (btnRect.right > navRect.right - NAV_PAD) {
      nav.scrollBy({ left: btnRect.right - navRect.right + NAV_PAD, behavior: 'smooth' })
    }
  }, [])

  // 激活项变化时自动滚动到可视位置
  useEffect(() => {
    if (activeVisible) revealActiveTab(active)
  }, [active, activeVisible, revealActiveTab])

  // 容器尺寸变化后仍保证激活项可见
  useEffect(() => {
    const onResize = () => {
      if (activeVisible) revealActiveTab(active)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [active, activeVisible, revealActiveTab])

  return (
    <div className='tw'>
      <header className='tw__header'>
        <div className='tw__header-text'>
          <h1 className='tw__title'>🧰 工具箱</h1>
          <p className='tw__subtitle'>开发者常用小工具</p>
        </div>
        {headerActions && <div className='tw__header-actions'>{headerActions}</div>}
      </header>

      <nav ref={navRef} className='tw-nav' role='tablist' aria-label='工具箱选项卡'>
        {tools.map((tool) => (
          <button
            key={tool.id}
            type='button'
            role='tab'
            aria-selected={active === tool.id}
            data-tool={tool.id}
            className={`tw-nav__btn${active === tool.id ? ' tw-nav__btn--on' : ''}`}
            onClick={() => setActive(tool.id)}
          >
            {tool.label}
          </button>
        ))}
      </nav>

      <main className='tw__body' role='tabpanel'>
        {TOOL_COMPONENTS[active]()}
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
