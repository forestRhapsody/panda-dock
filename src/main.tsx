import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'

import ToolkitOverlay from '@/content/ToolkitOverlay'
import OptionsPage from '@/options/OptionsPage'
import Popup from '@/popup/Popup'
import ToolsApp from '@/tools/ToolsApp'
import Icon from '@/ui/Icon'

import '@/content/content.css'
import '@/tools/tools.css'
import '@/theme.css'
import '@/ui/ui.css'
import './index.css'

/**
 * 开发预览页（仅 `pnpm dev` 使用，不参与扩展构建）：
 * 在普通浏览器里直接预览 Popup / Options / 工具箱页(侧边栏&抽屉共用) / 悬浮球的 UI。
 * chrome.* API 在浏览器里不存在，组件会自动降级为「浏览器预览」模式。
 */
function DevPreview() {
  return (
    <div className='pv'>
      <header className='pv__hero'>
        <h1>
          <Icon name='toolbox' size={22} />
          Toolkit Extension · 开发预览
        </h1>
        <p>
          以下为各入口 UI。安装到 Chrome 后请以 <code>dist/</code> 目录加载扩展
          （chrome://extensions → 开发者模式 → 加载已解压的扩展程序）。
        </p>
      </header>

      <section className='pv__section'>
        <h2 className='pv__section-title'>
          <span className='pv__tag'>Popup</span> 点击工具栏图标的弹窗
        </h2>
        <div className='pv__popup-frame'>
          <Popup />
        </div>
      </section>

      <section className='pv__section'>
        <h2 className='pv__section-title'>
          <span className='pv__tag'>Side Panel</span> 工具箱页（原生侧边栏 / 网页内抽屉共用）
        </h2>
        <div className='pv__tools-frame'>
          <ToolsApp />
        </div>
      </section>

      <section className='pv__section'>
        <h2 className='pv__section-title'>
          <span className='pv__tag'>Options</span> 设置页（右键图标 → 选项）
        </h2>
        <OptionsPage />
      </section>

      <section className='pv__section'>
        <h2 className='pv__section-title'>
          <span className='pv__tag'>Content Script</span> 注入到网页的悬浮球与抽屉
        </h2>
        <p className='pv__note'>
          真实扩展会向每个 http(s) 页面注入一颗<b>可拖拽的悬浮球</b>：拖动可贴靠屏幕左右两侧，
          鼠标移开只露一半、悬停完整滑出。点击悬浮球默认在网页右侧弹出<b>工具箱抽屉</b>
          （浏览器预览中即此效果；真实 Chrome 中可在设置里改为唤起原生侧边栏，且侧边栏页可反向
          「在网页中打开」抽屉）。请点击页面<b>右侧中部</b>的悬浮球体验。
        </p>
      </section>

      <ToolkitOverlay />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevPreview />
  </StrictMode>,
)
