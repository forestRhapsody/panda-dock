import { useEffect } from 'react'

import { storageGet } from '@/utils/env'
import type { LocaleSetting } from '@/utils/settings'

import i18n from './index'

const SETTINGS_KEY = 'settings'

/** 把语言设置解析成实际语言：system 按浏览器语言（zh → 中文，否则英文） */
export function resolveLocale(setting: LocaleSetting): 'zh' | 'en' {
  if (setting === 'zh' || setting === 'en') return setting
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * 读取并应用「语言」设置（chrome.storage.sync 的 settings.locale）。
 * 默认跟随系统；监听 onChanged 即时切换。各入口（Popup / Options / 侧边栏 / content）顶部调用。
 */
export function useLocale(): void {
  useEffect(() => {
    const apply = (setting?: LocaleSetting) => {
      void i18n.changeLanguage(resolveLocale(setting ?? 'system'))
    }
    void storageGet<{ locale?: LocaleSetting }>('sync', SETTINGS_KEY).then((s) => apply(s?.locale))

    const hasChrome = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'sync' || changes[SETTINGS_KEY] == null) return
      apply((changes[SETTINGS_KEY].newValue as { locale?: LocaleSetting } | undefined)?.locale)
    }
    if (hasChrome) chrome.storage.onChanged.addListener(onChange)

    return () => {
      if (hasChrome) chrome.storage.onChanged.removeListener(onChange)
    }
  }, [])
}
