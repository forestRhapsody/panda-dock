import { useCallback, useEffect, useState } from 'react'

import { useTranslation } from 'react-i18next'

import TkSelect from '@/ui/TkSelect'
import Tooltip from '@/ui/Tooltip'
import { isDomainMatched, shouldShowFloatingBall } from '@/utils/domainMatch'
import { isExtension, storageGet, storageSet } from '@/utils/env'
import type { BallAction } from '@/utils/messages'
import { getCurrentPageUrl } from '@/utils/pageUrl'
import { LOCALE_OPTIONS, normalizeSettings, THEME_OPTIONS } from '@/utils/settings'
import type { LocaleSetting, Settings, ThemeMode } from '@/utils/settings'

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

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = normalizeSettings({ ...prev, ...patch })
        if (inExt) void storageSet('sync', SETTINGS_KEY, next)
        return next
      })
    },
    [inExt],
  )

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
    {
      value: settings.ballSnap,
      labelKey: 'settings.ballSnap',
      descKey: 'settings.ballSnapDesc',
      set: (v) => update({ ballSnap: v }),
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
              className={`tk-switch${item.value ? ' tk-switch--on' : ''}`}
              onClick={() => item.set(!item.value)}
            >
              <span className='tk-switch__knob' />
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
                    ? t('settings.domainModeBlacklist').split('（')[0]
                    : t('settings.domainModeWhitelist').split('（')[0]}
                </span>
              </p>
            </div>
            <Tooltip content={siteAllowed ? t('popup.disableOnSite') : t('popup.enableOnSite')}>
              <button
                type='button'
                role='switch'
                aria-checked={siteAllowed}
                className={`tk-switch${siteAllowed ? ' tk-switch--on' : ''}`}
                onClick={toggleSiteBall}
                aria-label={siteAllowed ? t('popup.disableOnSite') : t('popup.enableOnSite')}
              >
                <span className='tk-switch__knob' />
              </button>
            </Tooltip>
          </li>
        )}
        <li className='pop__setting'>
          <div className='pop__setting-text'>
            <strong>{t('settings.ballAction')}</strong>
            <p>
              {t('settings.actionDrawer')} / {t('settings.actionNative')}
            </p>
          </div>
          <TkSelect
            variant='sm'
            value={settings.ballAction}
            onChange={(e) => update({ ballAction: e.target.value as BallAction })}
            aria-label={t('settings.ballAction')}
          >
            <option value='drawer'>{t('settings.actionDrawer')}</option>
            <option value='native'>{t('settings.actionNative')}</option>
          </TkSelect>
        </li>
        <li className='pop__setting'>
          <div className='pop__setting-text'>
            <strong>{t('settings.theme')}</strong>
            <p>{t('settings.themeDesc')}</p>
          </div>
          <TkSelect
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
          </TkSelect>
        </li>
        <li className='pop__setting'>
          <div className='pop__setting-text'>
            <strong>{t('settings.language')}</strong>
            <p>{t('settings.languageDesc')}</p>
          </div>
          <TkSelect
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
          </TkSelect>
        </li>
      </ul>
    </div>
  )
}
