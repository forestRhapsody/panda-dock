import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import NumberInput from '@/ui/NumberInput'
import PdSelect from '@/ui/PdSelect'
import { toast } from '@/ui/toast'
import Tooltip from '@/ui/Tooltip'
import { isDomainMatched, shouldShowFloatingBall } from '@/utils/domainMatch'
import { isExtension, storageGet } from '@/utils/env'
import type { BallAction } from '@/utils/messages'
import { getCurrentPageUrl } from '@/utils/pageUrl'
import {
  BALL_DOCK_MODE_OPTIONS,
  LOCALE_OPTIONS,
  normalizeSettings,
  saveSettings,
  THEME_OPTIONS,
} from '@/utils/settings'
import type { BallDockMode, LocaleSetting, Settings, ThemeMode } from '@/utils/settings'

const SETTINGS_KEY = 'settings'

/**
 * Popup 里的「快捷设置」：把 Options 里最常用、需要快速切换的项放这里。
 * 与 Options 共用同一份 `settings`（chrome.storage.sync），改动即时同步。
 */
export default function QuickSettings() {
  const { t } = useTranslation()
  const inExt = isExtension()
  const [settings, setSettings] = useState<Settings>(() => normalizeSettings(null))
  const [currentSite, setCurrentSite] = useState<{ host: string; hostname: string } | null>(null)

  // 读取已存配置 + 监听外部（Options / 悬浮球等）改动即时同步
  useEffect(() => {
    if (!inExt) return
    let alive = true
    void storageGet<Partial<Settings>>('sync', SETTINGS_KEY).then((stored) => {
      if (alive) setSettings(normalizeSettings(stored))
    })
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'sync' || changes[SETTINGS_KEY] == null) return
      setSettings(
        normalizeSettings(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined),
      )
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => {
      alive = false
      chrome.storage.onChanged.removeListener(onChange)
    }
  }, [inExt])

  // 获取当前活动标签页的 host / hostname
  useEffect(() => {
    if (!inExt) return
    let alive = true
    void getCurrentPageUrl().then((url) => {
      if (!alive || !url) return
      try {
        const u = new URL(url)
        setCurrentSite({ host: u.host, hostname: u.hostname })
      } catch {
        // 非合法 URL 忽略
      }
    })
    return () => {
      alive = false
    }
  }, [inExt])

  /**
   * 用户主动修改后写回存储。
   * 用「脏标记 + effect」而不是在 setState 的 updater 里写存储：
   * updater 必须是纯函数（StrictMode 下会被调用两次），副作用放在 effect 里更安全；
   * 外部同步（storage.onChanged）触发的 setSettings 不会置脏，因此不会回环写回。
   */
  const dirtyRef = useRef(false)
  useEffect(() => {
    if (!inExt || !dirtyRef.current) return
    dirtyRef.current = false
    void saveSettings(settings).then((saved) => {
      if (!saved) toast.error(t('settings.saveFailed'))
    })
  }, [settings, inExt, t])

  const update = useCallback((patch: Partial<Settings>) => {
    dirtyRef.current = true
    setSettings((prev) => normalizeSettings({ ...prev, ...patch }))
  }, [])

  const siteAllowed = currentSite ? shouldShowFloatingBall(settings, currentSite) : true

  const toggleSiteBall = useCallback(() => {
    if (!currentSite) return
    const mode = settings.ballDomainMode
    const hostKey = currentSite.hostname

    if (mode === 'blacklist') {
      if (siteAllowed) {
        update({ ballBlacklist: [...settings.ballBlacklist, hostKey] })
      } else {
        update({
          ballBlacklist: settings.ballBlacklist.filter(
            (p) => !isDomainMatched(currentSite.host, currentSite.hostname, p),
          ),
        })
      }
    } else {
      if (siteAllowed) {
        update({
          ballWhitelist: settings.ballWhitelist.filter(
            (p) => !isDomainMatched(currentSite.host, currentSite.hostname, p),
          ),
        })
      } else {
        update({ ballWhitelist: [...settings.ballWhitelist, hostKey] })
      }
    }
  }, [
    currentSite,
    settings.ballDomainMode,
    settings.ballBlacklist,
    settings.ballWhitelist,
    siteAllowed,
    update,
  ])

  const toggles: {
    value: boolean
    labelKey: string
    descKey: string
    set: (v: boolean) => void
  }[] = [
    {
      value: settings.quickOpen,
      labelKey: 'settings.quickOpen',
      descKey: 'settings.quickOpenDesc',
      set: (v) => update({ quickOpen: v }),
    },
  ]

  return (
    <div className='pop__settings'>
      <div className='pop__settings-head'>{t('popup.quickSettings')}</div>
      <ul className='pop__settings-list'>
        {toggles.map((item) => (
          <li key={item.labelKey} className='pop__setting'>
            <div className='pop__setting-text'>
              <strong>{t(item.labelKey)}</strong>
              <p>{t(item.descKey)}</p>
            </div>
            <button
              type='button'
              role='switch'
              aria-checked={item.value}
              className={`pd-switch${item.value ? ' pd-switch--on' : ''}`}
              onClick={() => item.set(!item.value)}
            >
              <span className='pd-switch__knob' />
            </button>
          </li>
        ))}
        {currentSite && settings.quickOpen && (
          <li className='pop__setting'>
            <div className='pop__setting-text'>
              <strong>{currentSite.hostname}</strong>
              <p>
                {siteAllowed ? t('popup.siteBallShown') : t('popup.siteBallHidden')}
                {' · '}
                <span>
                  {settings.ballDomainMode === 'blacklist'
                    ? t('settings.domainModeBlacklistShort')
                    : t('settings.domainModeWhitelistShort')}
                </span>
              </p>
            </div>
            <Tooltip content={siteAllowed ? t('popup.disableOnSite') : t('popup.enableOnSite')}>
              <button
                type='button'
                role='switch'
                aria-checked={siteAllowed}
                className={`pd-switch${siteAllowed ? ' pd-switch--on' : ''}`}
                onClick={toggleSiteBall}
                aria-label={siteAllowed ? t('popup.disableOnSite') : t('popup.enableOnSite')}
              >
                <span className='pd-switch__knob' />
              </button>
            </Tooltip>
          </li>
        )}
        {settings.quickOpen && (
          <>
            <li className='pop__setting'>
              <div className='pop__setting-text'>
                <strong>{t('settings.ballDockMode')}</strong>
                <p>
                  {t(
                    BALL_DOCK_MODE_OPTIONS.find((o) => o.value === settings.ballDockMode)
                      ?.labelKey ?? 'settings.ballDockModeEdge',
                  )}
                </p>
              </div>
              <PdSelect
                variant='sm'
                value={settings.ballDockMode}
                onChange={(e) => {
                  const mode = e.target.value as BallDockMode
                  update({ ballDockMode: mode, ballSnap: mode === 'edge' })
                }}
                aria-label={t('settings.ballDockMode')}
              >
                {BALL_DOCK_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </PdSelect>
            </li>
            {settings.ballDockMode === 'bottomRight' && (
              <li className='pop__setting'>
                <div className='pop__setting-text'>
                  <strong>{t('settings.ballBottomRightOffset')}</strong>
                  <p>
                    {t('settings.offsetRight')}: {settings.ballBottomRightRight}px ·{' '}
                    {t('settings.offsetBottom')}: {settings.ballBottomRightBottom}px
                  </p>
                </div>
                <div className='pop__offset-group'>
                  <label className='pop__offset-item'>
                    <span>{t('settings.offsetRightShort')}</span>
                    <NumberInput
                      min={0}
                      max={800}
                      value={settings.ballBottomRightRight}
                      onChange={(val) => {
                        update({ ballBottomRightRight: val })
                      }}
                      className='pop__offset-input'
                      aria-label={t('settings.offsetRight')}
                    />
                  </label>
                  <label className='pop__offset-item'>
                    <span>{t('settings.offsetBottomShort')}</span>
                    <NumberInput
                      min={0}
                      max={800}
                      value={settings.ballBottomRightBottom}
                      onChange={(val) => {
                        update({ ballBottomRightBottom: val })
                      }}
                      className='pop__offset-input'
                      aria-label={t('settings.offsetBottom')}
                    />
                  </label>
                </div>
              </li>
            )}
            <li className='pop__setting pop__setting--col'>
              <div className='pop__setting-header'>
                <strong>{t('settings.ballAction')}</strong>
                <PdSelect
                  variant='sm'
                  value={settings.ballAction}
                  onChange={(e) => update({ ballAction: e.target.value as BallAction })}
                  aria-label={t('settings.ballAction')}
                >
                  <option value='drawer'>{t('settings.actionDrawer')}</option>
                  <option value='native'>{t('settings.actionNative')}</option>
                </PdSelect>
              </div>
              <div className='pop__setting-tips'>
                <p className='pop__setting-tip'>
                  <strong>{t('settings.ballActionDrawerTitle')}</strong>
                  {t('settings.ballActionDrawerTip')}
                </p>
                <p className='pop__setting-tip'>
                  <strong>{t('settings.ballActionNativeTitle')}</strong>
                  {t('settings.ballActionNativeTip')}
                </p>
              </div>
            </li>
          </>
        )}
        <li className='pop__setting'>
          <div className='pop__setting-text'>
            <strong>{t('settings.theme')}</strong>
            <p>{t('settings.themeDesc')}</p>
          </div>
          <PdSelect
            variant='sm'
            value={settings.theme}
            onChange={(e) => update({ theme: e.target.value as ThemeMode })}
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
          </PdSelect>
        </li>
        <li className='pop__setting'>
          <div className='pop__setting-text'>
            <strong>{t('settings.language')}</strong>
            <p>{t('settings.languageDesc')}</p>
          </div>
          <PdSelect
            variant='sm'
            value={settings.locale}
            onChange={(e) => update({ locale: e.target.value as LocaleSetting })}
            aria-label={t('settings.language')}
          >
            {LOCALE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'system' ? t('settings.localeSystem') : o.label}
              </option>
            ))}
          </PdSelect>
        </li>
      </ul>
    </div>
  )
}
