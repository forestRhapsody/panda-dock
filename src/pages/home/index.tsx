import Icon from '@/ui/Icon'
import type { IconName } from '@/ui/Icon'
import { extVersion, isExtension, openOptionsPage } from '@/utils/env'

import './index.css'

interface Feature {
  icon: IconName
  title: string
  desc: string
}

const FEATURES: Feature[] = [
  { icon: 'window', title: 'Popup 弹窗', desc: '点击工具栏图标打开，适合放快捷操作' },
  { icon: 'settings', title: 'Options 设置页', desc: '扩展配置项，数据存 chrome.storage' },
  { icon: 'code', title: '页面注入', desc: 'Content Script 向网页注入悬浮面板' },
]

/**
 * 示例「首页 / 仪表盘」，纯展示组件，不依赖 chrome.* API。
 * Popup 与浏览器预览页都会用到它，后续可替换为你的业务首页。
 */
export default function Home() {
  const inExt = isExtension()

  return (
    <div className='hm'>
      <section className='hm__hero'>
        <div className='hm__logo'>
          <Icon name='toolbox' size={40} />
        </div>
        <h1 className='hm__title'>Toolkit Extension</h1>
        <p className='hm__desc'>基于 React + Vite + TypeScript 的 Chrome 扩展骨架</p>
      </section>

      <section className='hm__features'>
        {FEATURES.map((f) => (
          <div key={f.title} className='hm__feature'>
            <span className='hm__feature-icon'>
              <Icon name={f.icon} size={18} />
            </span>
            <div>
              <strong>{f.title}</strong>
              <p>{f.desc}</p>
            </div>
          </div>
        ))}
      </section>

      <footer className='hm__footer'>
        <span>v{extVersion()}</span>
        <span className={`hm__env hm__env--${inExt ? 'ext' : 'preview'}`}>
          {inExt ? '扩展环境' : '浏览器预览'}
        </span>
        {inExt && (
          <button className='hm__link' onClick={openOptionsPage}>
            打开设置 →
          </button>
        )}
      </footer>
    </div>
  )
}
