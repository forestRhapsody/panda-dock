import { useEffect, useState } from 'react'

import { isExtension, storageGet, storageSet } from '@/utils/env'
import type { BallAction } from '@/utils/messages'

import './index.css'

interface Settings {
  quickOpen: boolean
  showEnvBadge: boolean
  ballAction: BallAction
}

interface ToggleField {
  key: 'quickOpen' | 'showEnvBadge'
  title: string
  desc: string
}

const DEFAULTS: Settings = {
  quickOpen: true,
  showEnvBadge: false,
  ballAction: 'drawer',
}

const TOGGLE_FIELDS: ToggleField[] = [
  {
    key: 'quickOpen',
    title: '页面悬浮球',
    desc: '在网页上显示可拖拽的 Toolkit 悬浮球（由 Content Script 注入）',
  },
  {
    key: 'showEnvBadge',
    title: '显示版本角标',
    desc: '在 Popup 首页展示当前运行环境标识',
  },
]

function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  return {
    quickOpen: raw?.quickOpen ?? DEFAULTS.quickOpen,
    showEnvBadge: raw?.showEnvBadge ?? DEFAULTS.showEnvBadge,
    ballAction: raw?.ballAction === 'native' ? 'native' : DEFAULTS.ballAction,
  }
}

/** Options 设置页：配置项 + chrome.storage.sync 持久化 */
export default function OptionsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [saved, setSaved] = useState(false)
  const inExt = isExtension()

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
    setSaved(false)
    if (inExt) {
      void storageSet('sync', 'settings', next).then((ok) => setSaved(ok))
    }
  }

  function toggle(key: 'quickOpen' | 'showEnvBadge') {
    persist({ ...settings, [key]: !settings[key] })
  }

  function setBallAction(ballAction: BallAction) {
    persist({ ...settings, ballAction })
  }

  return (
    <div className='opt'>
      <header className='opt__header'>
        <h1>🧰 Toolkit Extension 设置</h1>
        <p className='opt__env'>
          {inExt ? '已连接 chrome.storage.sync' : '浏览器预览模式（配置不会被持久化）'}
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
          <p className={`opt__saved${saved ? ' opt__saved--show' : ''}`}>
            ✓ 已保存到 chrome.storage.sync（settings）
          </p>
        </div>

        <div className='opt__card opt__card--muted'>
          <h2>扩展骨架说明</h2>
          <ul className='opt__notes'>
            <li>
              Popup → <code>popup.html</code>（<code>src/popup/</code>）
            </li>
            <li>
              Options → <code>options.html</code>（<code>src/options/</code>）
            </li>
            <li>
              原生侧边栏 → <code>sidepanel.html</code>（<code>src/sidepanel/</code>）
            </li>
            <li>
              页面注入 → <code>src/content/</code>（悬浮球 + 网页内抽屉）
            </li>
            <li>
              Background → <code>src/background/</code>（唤起侧边栏中转）
            </li>
          </ul>
        </div>
      </main>
    </div>
  )
}
