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
import { useTranslation } from 'react-i18next'

import { useLocale } from '@/i18n/useLocale'
import type { ToolId } from '@/tools/registry'
import { DEFAULT_TOOLS, defaultToolLayout } from '@/tools/registry'
import Icon from '@/ui/Icon'
import TkSelect from '@/ui/TkSelect'
import { parseDomainPatterns } from '@/utils/domainMatch'
import { isExtension, storageGet, storageSet } from '@/utils/env'
import { useFontScale } from '@/utils/fontScale'
import type { BallAction } from '@/utils/messages'
import {
  defaultSettings,
  FONT_SCALE_OPTIONS,
  LOCALE_OPTIONS,
  normalizeSettings,
  THEME_OPTIONS,
} from '@/utils/settings'
import type { DomainMatchMode, LocaleSetting, Settings, ThemeMode } from '@/utils/settings'
import { useTheme } from '@/utils/theme'

import './index.css'

interface ToggleField {
  key: 'quickOpen' | 'ballSnap'
  titleKey: string
  descKey: string
}

const TOOL_META = new Map(DEFAULT_TOOLS.map((t) => [t.id, t]))

const TOGGLE_FIELDS: ToggleField[] = [
  {
    key: 'quickOpen',
    titleKey: 'settings.quickOpen',
    descKey: 'settings.quickOpenDesc',
  },
  {
    key: 'ballSnap',
    titleKey: 'settings.ballSnap',
    descKey: 'settings.ballSnapDesc',
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
  const { t } = useTranslation()
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
      <span
        className='opt-tools__grip'
        {...attributes}
        {...listeners}
        title={t('settings.dragToReorder')}
      >
        <Icon name='grip' size={14} />
      </span>
      <span className='opt-tools__name'>{label}</span>
      <span className='opt-tools__hint'>{on ? t('settings.showing') : t('settings.hidden')}</span>
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
  const { t } = useTranslation()
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [domainTab, setDomainTab] = useState<DomainMatchMode>('blacklist')
  const [blacklistText, setBlacklistText] = useState('')
  const [whitelistText, setWhitelistText] = useState('')
  const inExt = isExtension()

  // 使整体字体大小随设置即时缩放（含本设置页）
  useLocale()
  useFontScale()
  useTheme()

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
      if (alive) {
        const s = normalizeSettings(stored)
        setSettings(s)
        setDomainTab(s.ballDomainMode)
        setBlacklistText(s.ballBlacklist.join('\n'))
        setWhitelistText(s.ballWhitelist.join('\n'))
      }
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

  function setTheme(theme: ThemeMode) {
    persist({ ...settings, theme })
  }

  function setLocale(locale: LocaleSetting) {
    persist({ ...settings, locale })
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
          {t('settings.title')}
        </h1>
        <p className='opt__env'>{inExt ? t('settings.saved') : t('settings.previewMode')}</p>
      </header>

      <main className='opt__main'>
        <div className='opt__card'>
          <h2>{t('settings.ballSection')}</h2>
          <ul className='opt__list'>
            {TOGGLE_FIELDS.map((f) => (
              <li key={f.key} className='opt__item'>
                <div className='opt__item-text'>
                  <strong>{t(f.titleKey)}</strong>
                  <p>{t(f.descKey)}</p>
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
                <strong>{t('settings.ballAction')}</strong>
                <p>{t('settings.ballActionDesc')}</p>
              </div>
              <TkSelect
                value={settings.ballAction}
                onChange={(e) => setBallAction(e.target.value as BallAction)}
                aria-label={t('settings.ballAction')}
              >
                <option value='drawer'>{t('settings.actionDrawer')}</option>
                <option value='native'>{t('settings.actionNative')}</option>
              </TkSelect>
            </li>
          </ul>
        </div>

        <div className='opt__card'>
          <h2>{t('settings.domainSection')}</h2>
          <ul className='opt__list'>
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>{t('settings.domainMode')}</strong>
                <p>{t('settings.domainModeDesc')}</p>
              </div>
              <TkSelect
                value={settings.ballDomainMode}
                onChange={(e) => {
                  const mode = e.target.value as DomainMatchMode
                  persist({ ...settings, ballDomainMode: mode })
                  setDomainTab(mode)
                }}
                aria-label={t('settings.domainMode')}
              >
                <option value='blacklist'>{t('settings.domainModeBlacklist')}</option>
                <option value='whitelist'>{t('settings.domainModeWhitelist')}</option>
              </TkSelect>
            </li>
          </ul>

          <div className='opt__domain-header'>
            <div className='opt__domain-tabs' role='tablist'>
              <button
                type='button'
                role='tab'
                aria-selected={domainTab === 'blacklist'}
                className={`opt__domain-tab${domainTab === 'blacklist' ? ' opt__domain-tab--active' : ''}`}
                onClick={() => setDomainTab('blacklist')}
              >
                <span>{t('settings.domainBlacklist')}</span>
                <span
                  className={`opt__domain-tag${settings.ballDomainMode === 'blacklist' ? ' opt__domain-tag--active' : ''}`}
                >
                  {settings.ballBlacklist.length}
                </span>
              </button>
              <button
                type='button'
                role='tab'
                aria-selected={domainTab === 'whitelist'}
                className={`opt__domain-tab${domainTab === 'whitelist' ? ' opt__domain-tab--active' : ''}`}
                onClick={() => setDomainTab('whitelist')}
              >
                <span>{t('settings.domainWhitelist')}</span>
                <span
                  className={`opt__domain-tag${settings.ballDomainMode === 'whitelist' ? ' opt__domain-tag--active' : ''}`}
                >
                  {settings.ballWhitelist.length}
                </span>
              </button>
            </div>
          </div>

          <div className='opt__domain-box'>
            <p className='opt__domain-desc'>
              {domainTab === 'blacklist'
                ? t('settings.domainBlacklistDesc')
                : t('settings.domainWhitelistDesc')}
            </p>
            {domainTab === 'blacklist' ? (
              <textarea
                className='opt__domain-textarea'
                rows={5}
                placeholder={t('settings.domainPlaceholder')}
                value={blacklistText}
                onChange={(e) => setBlacklistText(e.target.value)}
                onBlur={() => {
                  const parsed = parseDomainPatterns(blacklistText)
                  setBlacklistText(parsed.join('\n'))
                  persist({ ...settings, ballBlacklist: parsed })
                }}
              />
            ) : (
              <textarea
                className='opt__domain-textarea'
                rows={5}
                placeholder={t('settings.domainPlaceholder')}
                value={whitelistText}
                onChange={(e) => setWhitelistText(e.target.value)}
                onBlur={() => {
                  const parsed = parseDomainPatterns(whitelistText)
                  setWhitelistText(parsed.join('\n'))
                  persist({ ...settings, ballWhitelist: parsed })
                }}
              />
            )}
            <div className='opt__domain-foot'>
              <span>
                {t('settings.domainCount', {
                  count:
                    domainTab === 'blacklist'
                      ? settings.ballBlacklist.length
                      : settings.ballWhitelist.length,
                })}
              </span>
            </div>
          </div>
        </div>

        <div className='opt__card'>
          <h2>{t('settings.appearance')}</h2>
          <ul className='opt__list'>
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>{t('settings.theme')}</strong>
                <p>{t('settings.themeDesc')}</p>
              </div>
              <TkSelect
                value={settings.theme}
                onChange={(e) => setTheme(e.target.value as ThemeMode)}
                aria-label={t('settings.theme')}
              >
                {THEME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(
                      o.value === 'system'
                        ? 'settings.themeSystem'
                        : o.value === 'light'
                          ? 'settings.themeLight'
                          : 'settings.themeDark',
                    )}
                  </option>
                ))}
              </TkSelect>
            </li>
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>{t('settings.language')}</strong>
                <p>{t('settings.languageDesc')}</p>
              </div>
              <TkSelect
                value={settings.locale}
                onChange={(e) => setLocale(e.target.value as LocaleSetting)}
                aria-label={t('settings.language')}
              >
                {LOCALE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value === 'system' ? t('settings.localeSystem') : o.label}
                  </option>
                ))}
              </TkSelect>
            </li>
          </ul>
        </div>

        <div className='opt__card'>
          <h2>{t('settings.display')}</h2>
          <ul className='opt__list'>
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>{t('settings.fontScale')}</strong>
                <p>{t('settings.fontScaleDesc')}</p>
              </div>
              <TkSelect
                value={settings.fontScale}
                onChange={(e) => setFontScale(Number(e.target.value))}
                aria-label={t('settings.fontScale')}
              >
                {FONT_SCALE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(
                      o.value === 1
                        ? 'settings.fontStandard'
                        : o.value === 1.1
                          ? 'settings.fontLarge'
                          : 'settings.fontMax',
                    )}
                  </option>
                ))}
              </TkSelect>
            </li>
          </ul>
        </div>

        <div className='opt__card'>
          <div className='opt__card-head'>
            <h2>{t('settings.toolbox')}</h2>
            <button type='button' className='opt__reset' onClick={resetLayout}>
              {t('settings.resetDefault')}
            </button>
          </div>
          <p className='opt__env'>{t('settings.toolboxDesc')}</p>

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
                      label={t(`tool.registry.${id}`)}
                      on={settings.toolEnabled[id] !== false}
                      onToggle={toggleTool}
                    />
                  )
                })}
              </ul>
            </SortableContext>
          </DndContext>

          <p className='opt__env opt__env--hint'>{t('settings.toolboxHint')}</p>
        </div>
      </main>
    </div>
  )
}
