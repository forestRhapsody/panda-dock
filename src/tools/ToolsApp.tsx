import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  closestCenter,
  DndContext,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'

import AppLogo from '@/ui/AppLogo'
import { extVersion, isExtension, openOptionsPage, storageGet, storageSet } from '@/utils/env'
import { normalizeSettings } from '@/utils/settings'
import type { Settings } from '@/utils/settings'

import Base64Tool from './Base64Tool'
import DetectTool from './DetectTool'
import FileBase64Tool from './FileBase64Tool'
import JsonTool from './JsonTool'
import JwtTool from './JwtTool'
import QrCodeTool from './QrCodeTool'
import type { ToolId, ToolMeta } from './registry'
import { defaultToolLayout, normalizeToolLayout, visibleTools } from './registry'
import StorageTool from './StorageTool'
import TimestampTool from './TimestampTool'
import UrlTool from './UrlTool'

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
  url: () => <UrlTool />,
  qrcode: () => <QrCodeTool />,
  'file-b64': () => <FileBase64Tool />,
  detect: () => <DetectTool />,
}

interface SortableTabProps {
  id: ToolId
  label: string
  selected: boolean
  onSelect: (id: ToolId) => void
}

/** 单个可排序选项卡：按住拖动可调整顺序（保持点击仍能激活，与 Chrome 标签页一致） */
function SortableTab({ id, label, selected, onSelect }: SortableTabProps) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <button
      ref={setNodeRef}
      type='button'
      role='tab'
      aria-selected={selected}
      data-tool={id}
      className={`tw-nav__btn${selected ? ' tw-nav__btn--on' : ''}${isDragging ? ' tw-nav__btn--drag' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...listeners}
      onClick={() => {
        if (!isDragging) onSelect(id)
      }}
    >
      {label}
    </button>
  )
}

/**
 * 把「可见项的新顺序」回填到完整 `order`（含隐藏工具）：
 * 隐藏工具保持原位，可见工具按新顺序落到相对象槽位。
 */
function rebuildOrder(
  fullOrder: ToolId[],
  enabled: Record<string, boolean>,
  nextVisibleIds: ToolId[],
): ToolId[] {
  let vi = 0
  const used = new Set<ToolId>()
  const out: ToolId[] = []
  for (const id of fullOrder) {
    if (enabled[id] !== false) {
      const next = nextVisibleIds[vi] ?? id
      out.push(next)
      used.add(next)
      vi++
    } else {
      out.push(id)
    }
  }
  for (const id of nextVisibleIds) if (!used.has(id)) out.push(id)
  return out
}

/**
 * 工具箱页面（共享 UI）：
 * 同一个页面被原生侧边栏(sidepanel.html)、网页内抽屉(content Drawer)复用。
 * - 显示哪些工具、顺序如何，由 Options 里的配置（chrome.storage.sync）决定；
 * - 选项卡可**按住拖动排序**（chrome.storage.sync 即时持久化，Options 同步）；
 * - 配置修改后通过 chrome.storage.onChanged 即时同步到已打开的页面；
 * - 选项卡超出容器宽度时自动滚动，并把激活项滚到可视区（参考 Vant Tabs）。
 */
export default function ToolsApp({ headerActions }: ToolsAppProps) {
  const { t } = useTranslation()
  const inExt = isExtension()
  const [order, setOrder] = useState<ToolId[]>(() => defaultToolLayout().order)
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => defaultToolLayout().enabled)
  const [active, setActive] = useState<ToolId>('base64')
  const navRef = useRef<HTMLElement>(null)
  const initializedRef = useRef(false)
  const tools = useMemo<ToolMeta[]>(() => visibleTools({ order, enabled }), [order, enabled])

  const sensors = useSensors(
    // 指针移动超过 6px 才视为拖拽，避免误触（保证点击选项卡仍能正常激活）
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  // 读取工具显示配置（浏览器预览时用默认值：全部显示）
  useEffect(() => {
    if (!inExt) return
    let alive = true
    const apply = (settings: { toolOrder?: unknown; toolEnabled?: unknown } | null | undefined) => {
      const layout = normalizeToolLayout(settings?.toolOrder, settings?.toolEnabled)
      setOrder(layout.order)
      setEnabled(layout.enabled)
      // 打开时激活「配置顺序」里的第一个可见工具（而非硬编码 base64）；仅首次生效
      if (!initializedRef.current) {
        setActive(visibleTools(layout)[0]?.id ?? 'base64')
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
  const activeVisible = tools.some((tool) => tool.id === active)
  useEffect(() => {
    if (!activeVisible) setActive(tools[0]?.id ?? 'base64')
  }, [activeVisible, tools])

  // 拖拽排序结束：更新顺序并持久化到 settings.toolOrder
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const curVisibleIds = visibleTools({ order, enabled }).map((tool) => tool.id)
      const from = curVisibleIds.indexOf(active.id as ToolId)
      const to = curVisibleIds.indexOf(over.id as ToolId)
      if (from < 0 || to < 0) return
      const nextVisibleIds = arrayMove(curVisibleIds, from, to)
      const nextOrder = rebuildOrder(order, enabled, nextVisibleIds)
      setOrder(nextOrder)
      if (inExt) {
        void storageGet<Partial<Settings>>('sync', 'settings').then((cur) => {
          const next = normalizeSettings({ ...(cur ?? {}), toolOrder: nextOrder })
          void storageSet('sync', 'settings', next)
        })
      }
    },
    [order, enabled, inExt],
  )

  /** 把激活的选项卡滚动到容器水平居中（类似 Vant） */
  const revealActiveTab = useCallback((toolId: ToolId) => {
    const nav = navRef.current
    if (!nav) return
    const btn = nav.querySelector<HTMLButtonElement>(`.tw-nav__btn[data-tool="${toolId}"]`)
    if (!btn) return
    const navRect = nav.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    // 滚动量 = 按钮中心 与 容器中心 的水平偏移；浏览器会自动夹取在 [0, maxScroll]
    const delta = btnRect.left + btnRect.width / 2 - (navRect.left + navRect.width / 2)
    if (Math.abs(delta) > 0.5) nav.scrollBy({ left: delta, behavior: 'smooth' })
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
          <h1 className='tw__title'>
            <AppLogo size={17} />
            {t('app.title')}
          </h1>
          <p className='tw__subtitle'>{t('app.subtitle')}</p>
        </div>
        {headerActions && <div className='tw__header-actions'>{headerActions}</div>}
      </header>

      <nav ref={navRef} className='tw-nav' role='tablist' aria-label={t('app.nav_label')}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          autoScroll={false}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tools.map((tool) => tool.id)}
            strategy={horizontalListSortingStrategy}
          >
            {tools.map((tool) => (
              <SortableTab
                key={tool.id}
                id={tool.id}
                label={t(`tool.registry.${tool.id}`)}
                selected={active === tool.id}
                onSelect={setActive}
              />
            ))}
          </SortableContext>
        </DndContext>
      </nav>

      <main className='tw__body' role='tabpanel'>
        {TOOL_COMPONENTS[active]()}
      </main>

      <footer className='tw__footer'>
        <span>v{extVersion()}</span>
        {inExt && (
          <button type='button' className='tw__link' onClick={openOptionsPage}>
            {t('app.open_settings')}
          </button>
        )}
      </footer>
    </div>
  )
}
