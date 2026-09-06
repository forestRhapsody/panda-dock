import { useEffect, useRef, useState } from 'react'

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
import AppLogo from '@/ui/AppLogo'
import ConfirmDialog from '@/ui/ConfirmDialog'
import Icon from '@/ui/Icon'
import TkSelect from '@/ui/TkSelect'
import { parseDomainPatterns } from '@/utils/domainMatch'
import { isExtension, storageGet, storageSet } from '@/utils/env'
import { useFontScale } from '@/utils/fontScale'
import type { BallAction } from '@/utils/messages'
import {
  BALL_IMAGE_MAX_BYTES,
  BALL_PRESET_OPTIONS,
  BALL_SHAPE_OPTIONS,
  BALL_SIZE_OPTIONS,
  ballAssetUrl,
  defaultSettings,
  FONT_SCALE_OPTIONS,
  getBallImage,
  LOCALE_OPTIONS,
  normalizeSettings,
  setBallImage,
  THEME_OPTIONS,
} from '@/utils/settings'
import type {
  BallPreset,
  BallShape,
  BallSize,
  DomainMatchMode,
  LocaleSetting,
  Settings,
  ThemeMode,
} from '@/utils/settings'
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
      <button
        type='button'
        role='switch'
        aria-checked={on}
        aria-label={label}
        title={on ? t('settings.toolHide') : t('settings.toolShow')}
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
  const [showGlobalConfirm, setShowGlobalConfirm] = useState(false)
  const [ballImage, setBallImageState] = useState<string | null>(null)
  const [ballImageError, setBallImageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // 加载自定义悬浮球图片（chrome.storage.local）
  useEffect(() => {
    let alive = true
    void getBallImage().then((img) => {
      if (alive) setBallImageState(img)
    })
    return () => {
      alive = false
    }
  }, [])

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

  function setBallShape(ballShape: BallShape) {
    persist({ ...settings, ballShape })
  }

  function setBallPreset(ballPreset: BallPreset) {
    persist({ ...settings, ballPreset })
  }

  function setBallSize(ballSize: BallSize) {
    persist({ ...settings, ballSize })
  }

  /** 选择自定义图片：读为 base64 data URL，校验体积（≤128KB）后存 local */
  function onPickImage(file: File | undefined) {
    setBallImageError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setBallImageError(t('settings.ballImageTypeError'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      if (dataUrl.length > BALL_IMAGE_MAX_BYTES) {
        setBallImageError(t('settings.ballImageTooLarge'))
        return
      }
      setBallImageState(dataUrl)
      if (inExt) void setBallImage(dataUrl)
    }
    reader.onerror = () => setBallImageError(t('settings.ballImageReadError'))
    reader.readAsDataURL(file)
  }

  function removeBallImage() {
    setBallImageError(null)
    setBallImageState(null)
    if (inExt) void setBallImage(null)
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

  /** 恢复「域名黑白名单」这块到默认（黑名单模式 + 清空名单） */
  function resetDomainRules() {
    const base = defaultSettings()
    persist({
      ...settings,
      ballDomainMode: base.ballDomainMode,
      ballBlacklist: base.ballBlacklist,
      ballWhitelist: base.ballWhitelist,
    })
    setDomainTab(base.ballDomainMode)
    setBlacklistText('')
    setWhitelistText('')
  }

  /** 恢复「悬浮球与侧边栏」这块到默认（显示、吸边、点击动作） */
  function resetBallSection() {
    const base = defaultSettings()
    persist({
      ...settings,
      quickOpen: base.quickOpen,
      ballSnap: base.ballSnap,
      ballAction: base.ballAction,
    })
  }

  /** 恢复「悬浮球样式」到默认（形状、预设、大小、自定义图片） */
  function resetBallStyle() {
    const base = defaultSettings()
    persist({
      ...settings,
      ballShape: base.ballShape,
      ballPreset: base.ballPreset,
      ballSize: base.ballSize,
    })
    setBallImageState(null)
    setBallImageError(null)
    if (inExt) void setBallImage(null)
  }

  /** 恢复「外观与显示」到默认（主题、语言、字号） */
  function resetAppearance() {
    const base = defaultSettings()
    persist({
      ...settings,
      theme: base.theme,
      locale: base.locale,
      fontScale: base.fontScale,
    })
  }

  /** 打开「恢复默认设置」确认弹窗 */
  function requestGlobalReset() {
    setShowGlobalConfirm(true)
  }

  /** 确认后：把全部设置恢复为默认，并同步重置本页的域名编辑状态 */
  function doGlobalReset() {
    const base = defaultSettings()
    persist(base)
    setDomainTab(base.ballDomainMode)
    setBlacklistText('')
    setWhitelistText('')
    setBallImageState(null)
    setBallImageError(null)
    if (inExt) void setBallImage(null)
    setShowGlobalConfirm(false)
  }

  return (
    <div className='opt'>
      <header className='opt__header'>
        <h1>
          <AppLogo size={20} />
          {t('settings.title')}
        </h1>
        <p className='opt__env'>{inExt ? t('settings.saved') : t('settings.previewMode')}</p>
      </header>

      <main className='opt__main'>
        <div className='opt__card'>
          <div className='opt__card-head'>
            <h2>{t('settings.ballSection')}</h2>
            <button
              type='button'
              className='opt__reset'
              onClick={resetBallSection}
              title={t('settings.resetDefault')}
            >
              {t('settings.resetDefault')}
            </button>
          </div>
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
          <div className='opt__card-head'>
            <h2>{t('settings.ballStyleSection')}</h2>
            <button
              type='button'
              className='opt__reset'
              onClick={resetBallStyle}
              title={t('settings.resetDefault')}
            >
              {t('settings.resetDefault')}
            </button>
          </div>
          <ul className='opt__list'>
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>{t('settings.ballShape')}</strong>
                <p>{t('settings.ballShapeDesc')}</p>
              </div>
              <TkSelect
                value={settings.ballShape}
                onChange={(e) => setBallShape(e.target.value as BallShape)}
                aria-label={t('settings.ballShape')}
              >
                {BALL_SHAPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </TkSelect>
            </li>
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>{t('settings.ballPreset')}</strong>
                <p>{t('settings.ballPresetDesc')}</p>
              </div>
              <div
                className='opt-ball-presets'
                role='radiogroup'
                aria-label={t('settings.ballPreset')}
              >
                {BALL_PRESET_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type='button'
                    role='radio'
                    aria-checked={settings.ballPreset === o.value}
                    title={t(o.labelKey)}
                    className={`opt-ball-preset${settings.ballPreset === o.value ? ' opt-ball-preset--on' : ''}`}
                    onClick={() => setBallPreset(o.value)}
                  >
                    {o.image ? (
                      <img
                        src={ballAssetUrl(o.image)}
                        alt=''
                        aria-hidden='true'
                        draggable={false}
                        className='opt-ball-preset__img'
                      />
                    ) : (
                      <span className='opt-ball-preset__logo'>{o.icon}</span>
                    )}
                  </button>
                ))}
              </div>
            </li>
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>{t('settings.ballSize')}</strong>
                <p>{t('settings.ballSizeDesc')}</p>
              </div>
              <TkSelect
                value={settings.ballSize}
                onChange={(e) => setBallSize(e.target.value as BallSize)}
                aria-label={t('settings.ballSize')}
              >
                {BALL_SIZE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </TkSelect>
            </li>
            <li className='opt__item'>
              <div className='opt__item-text'>
                <strong>{t('settings.ballImage')}</strong>
                <p>{t('settings.ballImageDesc')}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {ballImage ? (
                  <img
                    src={ballImage}
                    alt=''
                    aria-hidden='true'
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      objectFit: 'cover',
                      border: '1px solid var(--tk-input)',
                    }}
                  />
                ) : null}
                <button
                  type='button'
                  className='tk-btn tk-btn--sm'
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('settings.ballImageChoose')}
                </button>
                {ballImage && (
                  <button type='button' className='tk-btn tk-btn--sm' onClick={removeBallImage}>
                    {t('settings.ballImageRemove')}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    onPickImage(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </div>
            </li>
          </ul>
          {ballImageError && <p className='opt__env opt__env--error'>{ballImageError}</p>}
          <p className='opt__env opt__env--hint'>{t('settings.ballImageLimit')}</p>
          {ballImage && <p className='opt__env opt__env--hint'>{t('settings.ballImageNote')}</p>}
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

        <div className='opt__card'>
          <div className='opt__card-head'>
            <h2>{t('settings.domainSection')}</h2>
            <button
              type='button'
              className='opt__reset'
              onClick={resetDomainRules}
              title={t('settings.resetDefault')}
            >
              {t('settings.resetDefault')}
            </button>
          </div>
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
          <div className='opt__card-head'>
            <h2>{t('settings.appearanceDisplay')}</h2>
            <button
              type='button'
              className='opt__reset'
              onClick={resetAppearance}
              title={t('settings.resetDefault')}
            >
              {t('settings.resetDefault')}
            </button>
          </div>
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

        <div className='opt__card opt__card--danger'>
          <h2>{t('settings.restoreDefaults')}</h2>
          <p className='opt__env'>{t('settings.restoreDefaultsDesc')}</p>
          <div className='opt__reset-row'>
            <button type='button' className='tk-btn' onClick={requestGlobalReset}>
              {t('settings.restoreDefaults')}
            </button>
          </div>
        </div>
      </main>

      {showGlobalConfirm && (
        <ConfirmDialog
          title={t('settings.restoreDefaultsConfirmTitle')}
          message={t('settings.restoreDefaultsConfirmMsg')}
          onCancel={() => setShowGlobalConfirm(false)}
          onConfirm={doGlobalReset}
        />
      )}
    </div>
  )
}
