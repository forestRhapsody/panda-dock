import { useEffect, useState } from 'react'

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { ToolId } from '@/tools/registry'
import { DEFAULT_TOOLS, defaultToolLayout } from '@/tools/registry'
import Icon from '@/ui/Icon'
import { isExtension, storageGet, storageSet } from '@/utils/env'
import { useFontScale } from '@/utils/fontScale'
import type { BallAction } from '@/utils/messages'
import { defaultSettings, FONT_SCALE_OPTIONS, normalizeSettings } from '@/utils/settings'
import type { Settings } from '@/utils/settings'

import './index.css'

interface ToggleField {
  key: 'quickOpen' | 'ballSnap'
  title: string
  desc: string
}

const TOOL_META = new Map(DEFAULT_TOOLS.map((t) => [t.id, t]))

const TOGGLE_FIELDS: ToggleField[] = [
  {
    key: 'quickOpen',
    title: '页面悬浮球',
    desc: '在网页上显示可拖拽的 Toolkit 悬浮球（由 Content Script 注入）',
  },
  {
    key: 'ballSnap',
    title: '悬浮球吸边',
    desc: '拖拽后自动贴靠屏幕左右两侧；关闭后悬浮球可以停留在任意位置',
  },
]

interface SortableToolRowProps {
  id: ToolId
  label: string
  on: boolean
  onToggle: (id: ToolId) => void
}

/** 单个可排序工具行：拖动把手调整顺序（dnd-kit 自动处理滑动/回弹动画） */
function SortableToolRow({ id, label, on, onToggle }: SortableToolRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <li
      ref={setNodeRef}
      className={`opt-tools__row${isDragging ? ' opt-tools__row--drag' : ''}`}
      style={style}
    >
      <span className='opt-tools__grip' {...attributes} {...listeners} title='按住拖拽调整顺序'>
        <Icon name='grip' size={14} />
      </span>
      <span className='opt-tools__name'>{label}</span>
      <span className='opt-tools__hint'>{on ? '显示中' : '已隐藏'}</span>
      <button
        type='button'
        role='switch'
        aria-checked={on}
        className={`opt__switch${on ? ' opt__switch--on' : ''}`}
        onClick={() => onToggle(id)}
      >
        <span className='opt__switch-knob' />
      </button>
    </li>
  )
}

/** Options 设置页：配置项 + chrome.storage.sync 持久化（含工具箱能力显隐与拖拽排序） */
export default function OptionsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const inExt = isExtension()

  // 使整体字体大小随设置即时缩放（含本设置页）
  useFontScale()

  const sensors = useSensors(
    // 指针移动超过 6px 才视为拖拽，避免误触（保证开关点击可用）
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  // 进入设置页时从扩展存储读取配置
  useEffect(() => {
    if (!inExt) return
    let alive = true
    void (async () => {
      const stored = await storageGet<Partial<Settings>>('sync', 'settings')
      if (alive) setSettings(normalizeSettings(stored))
    })()
    return () => {
      alive = false
    }
  }, [inExt])

  function persist(next: Settings) {
    setSettings(next)
    if (inExt) {
      void storageSet('sync', 'settings', next)
    }
  }

  function toggle(key: 'quickOpen' | 'ballSnap') {
    persist({ ...settings, [key]: !settings[key] })
  }

  function setBallAction(ballAction: BallAction) {
    persist({ ...settings, ballAction })
  }

  function setFontScale(fontScale: number) {
    persist({ ...settings, fontScale })
  }

  function toggleTool(id: ToolId) {
    persist({
      ...settings,
      toolEnabled: { ...settings.toolEnabled, [id]: !(settings.toolEnabled[id] ?? true) },
    })
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const order = [...settings.toolOrder]
    const from = order.indexOf(active.id as ToolId)
    const to = order.indexOf(over.id as ToolId)
    if (from < 0 || to < 0) return
    persist({ ...settings, toolOrder: arrayMove(order, from, to) })
  }

  function resetLayout() {
    const layout = defaultToolLayout()
    persist({ ...settings, toolOrder: layout.order, toolEnabled: layout.enabled })
  }

  return (
    <div className='opt'>
      <header className='opt__header'>
        <h1>
          <Icon name='toolbox' size={20} />
          Toolkit Extension 设置
        </h1>
        <p className='opt__env'>
          {inExt
            ? '已保存到 chrome.storage.sync（settings）'
            : '浏览器预览模式（配置不会被持久化）'}
        </p>
      </header>

      <main className='opt__main'>
        <div className='opt__card'>
          <h2>悬浮球与侧边栏</h2>
          <ul className='opt__list'>
            {TOGGLE_FIELDS.map((f) => (
              <li key={f.key} className='opt__item'>
                <div className='opt__item-text'>
                  <strong>{f.title}</strong>
                  <p>{f.desc}</p>
                </div>
                <button
                  type='button'
                  role='switch'
                  aria-checked={settings[f.key]}
                  className={`opt__switch${settings[f.key] ? ' opt__switch--on' : ''}`}
                  onClick={() => toggle(f.key)}
                >
                  <span className='opt__switch-knob' />
                </button>
              </li>
            ))}
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>点击悬浮球的动作</strong>
                <p>
                  网页内抽屉：在网页右侧弹出工具箱；浏览器侧边栏：尽力唤起原生侧边栏 （受 Chrome
                  手势限制，无法唤起时自动回退为网页内抽屉）。
                </p>
              </div>
              <select
                className='opt__select'
                value={settings.ballAction}
                onChange={(e) => setBallAction(e.target.value as BallAction)}
                aria-label='点击悬浮球的动作'
              >
                <option value='drawer'>网页内抽屉</option>
                <option value='native'>浏览器原生侧边栏</option>
              </select>
            </li>
          </ul>
        </div>

        <div className='opt__card'>
          <h2>显示与无障碍</h2>
          <ul className='opt__list'>
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>整体字体大小</strong>
                <p>调整所有界面的文字与按钮大小，让内容更易读。</p>
              </div>
              <select
                className='opt__select'
                value={settings.fontScale}
                onChange={(e) => setFontScale(Number(e.target.value))}
                aria-label='整体字体大小'
              >
                {FONT_SCALE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </li>
          </ul>
        </div>

        <div className='opt__card'>
          <div className='opt__card-head'>
            <h2>工具箱能力</h2>
            <button type='button' className='opt__reset' onClick={resetLayout}>
              恢复默认
            </button>
          </div>
          <p className='opt__env'>决定工具箱选项卡里显示哪些能力以及它们的顺序。</p>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={settings.toolOrder} strategy={verticalListSortingStrategy}>
              <ul className='opt-tools'>
                {settings.toolOrder.map((id) => {
                  const meta = TOOL_META.get(id)
                  if (!meta) return null
                  return (
                    <SortableToolRow
                      key={id}
                      id={id}
                      label={meta.label}
                      on={settings.toolEnabled[id] !== false}
                      onToggle={toggleTool}
                    />
                  )
                })}
              </ul>
            </SortableContext>
          </DndContext>

          <p className='opt__env opt__env--hint'>
            拖动把手调整顺序（带滑动动画）；关闭开关即在工具箱隐藏该能力。修改即时保存。
          </p>
        </div>
      </main>
    </div>
  )
}
