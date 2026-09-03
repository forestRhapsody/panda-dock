import { useCallback, useEffect, useState } from 'react'

import { isExtension, storageGet, storageSet } from '@/utils/env'
import type { BallAction } from '@/utils/messages'
import { FONT_SCALE_OPTIONS, normalizeSettings, THEME_OPTIONS } from '@/utils/settings'
import type { Settings, ThemeMode } from '@/utils/settings'

const SETTINGS_KEY = 'settings'

/**
 * Popup 里的「快捷设置」：把 Options 里最常用、需要快速切换的项放这里。
 * 与 Options 共用同一份 `settings`（chrome.storage.sync），改动即时同步。
 */
export default function QuickSettings() {
  const inExt = isExtension()
  const [settings, setSettings] = useState<Settings>(() => normalizeSettings(null))

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

  const toggles: { value: boolean; label: string; desc: string; set: (v: boolean) => void }[] = [
    {
      value: settings.quickOpen,
      label: '页面悬浮球',
      desc: '在网页上显示悬浮球',
      set: (v) => update({ quickOpen: v }),
    },
    {
      value: settings.ballSnap,
      label: '悬浮球吸边',
      desc: '拖拽后贴靠左右两侧',
      set: (v) => update({ ballSnap: v }),
    },
  ]

  return (
    <div className='pop__settings'>
      <div className='pop__settings-head'>快捷设置</div>
      <ul className='pop__settings-list'>
        {toggles.map((t) => (
          <li key={t.label} className='pop__setting'>
            <div className='pop__setting-text'>
              <strong>{t.label}</strong>
              <p>{t.desc}</p>
            </div>
            <button
              type='button'
              role='switch'
              aria-checked={t.value}
              className={`pop__switch${t.value ? ' pop__switch--on' : ''}`}
              onClick={() => t.set(!t.value)}
            >
              <span className='pop__switch-knob' />
            </button>
          </li>
        ))}
        <li className='pop__setting'>
          <div className='pop__setting-text'>
            <strong>点击悬浮球的动作</strong>
            <p>网页内抽屉 / 浏览器原生侧边栏</p>
          </div>
          <select
            className='pop__select'
            value={settings.ballAction}
            onChange={(e) => update({ ballAction: e.target.value as BallAction })}
            aria-label='点击悬浮球的动作'
          >
            <option value='drawer'>网页内抽屉</option>
            <option value='native'>浏览器原生侧边栏</option>
          </select>
        </li>
        <li className='pop__setting'>
          <div className='pop__setting-text'>
            <strong>主题</strong>
            <p>跟随系统 / 浅色 / 深色</p>
          </div>
          <select
            className='pop__select'
            value={settings.theme}
            onChange={(e) => update({ theme: e.target.value as ThemeMode })}
            aria-label='主题'
          >
            {THEME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </li>
        <li className='pop__setting'>
          <div className='pop__setting-text'>
            <strong>整体字体大小</strong>
            <p>调整所有界面的文字与按钮大小</p>
          </div>
          <select
            className='pop__select'
            value={settings.fontScale}
            onChange={(e) => update({ fontScale: Number(e.target.value) })}
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
  )
}
