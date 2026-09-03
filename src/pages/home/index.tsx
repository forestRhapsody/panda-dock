import { extVersion, isExtension, openOptionsPage } from '@/utils/env'

import './index.css'

/**
 * 示例「首页 / 仪表盘」，纯展示组件，不依赖 chrome.* API。
 * Popup 与浏览器预览页都会用到它，后续可替换为你的业务首页。
 */
export default function Home() {
  const inExt = isExtension()

  return (
    <div className='home'>
      <section className='home__hero'>
        <div className='home__logo'>🧰</div>
        <h1 className='home__title'>Toolkit Extension</h1>
        <p className='home__desc'>基于 React + Vite + TypeScript 的 Chrome 扩展骨架</p>
      </section>

      <section className='home__features'>
        <div className='home__feature'>
          <span className='home__feature-icon'>🪟</span>
          <div>
            <strong>Popup 弹窗</strong>
            <p>点击工具栏图标打开，适合放快捷操作</p>
          </div>
        </div>
        <div className='home__feature'>
          <span className='home__feature-icon'>⚙️</span>
          <div>
            <strong>Options 设置页</strong>
            <p>扩展配置项，数据存 chrome.storage</p>
          </div>
        </div>
        <div className='home__feature'>
          <span className='home__feature-icon'>📄</span>
          <div>
            <strong>页面注入</strong>
            <p>Content Script 向网页注入悬浮面板</p>
          </div>
        </div>
      </section>

      <footer className='home__footer'>
        <span>v{extVersion()}</span>
        <span className={`home__env home__env--${inExt ? 'ext' : 'preview'}`}>
          {inExt ? '扩展环境' : '浏览器预览'}
        </span>
        {inExt && (
          <button className='home__link' onClick={openOptionsPage}>
            打开设置 →
          </button>
        )}
      </footer>
    </div>
  )
}
