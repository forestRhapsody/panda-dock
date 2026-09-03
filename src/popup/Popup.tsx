import { useState } from 'react'

import Home from '@/pages/home'
import { isExtension, openOptionsPage } from '@/utils/env'
import { openNativeSidePanel } from '@/utils/sidePanel'

import './index.css'

/** Popup 弹窗界面：顶部工具栏 + 首页内容 */
export default function Popup() {
  const inExt = isExtension()
  const [nativeFailed, setNativeFailed] = useState(false)

  async function openPanel() {
    const ok = await openNativeSidePanel()
    setNativeFailed(!ok)
  }

  return (
    <div className='pop'>
      <header className='pop__header'>
        <span className='pop__title'>🧰 Toolkit</span>
        <button
          type='button'
          className='pop__settings'
          title='打开设置页'
          aria-label='打开设置页'
          onClick={openOptionsPage}
        >
          ⚙️
        </button>
      </header>
      {inExt && (
        <div className='pop__native'>
          <button type='button' className='pop__native-btn' onClick={() => void openPanel()}>
            🧭 在浏览器侧边栏打开工具箱
          </button>
          {nativeFailed && <p className='pop__native-hint'>未能唤起侧边栏，请重试或更新 Chrome</p>}
        </div>
      )}
      <main className='pop__body'>
        <Home />
      </main>
    </div>
  )
}
