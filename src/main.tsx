import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'
import { Trans, useTranslation } from 'react-i18next'

import ToolkitOverlay from '@/content/ToolkitOverlay'
import OptionsPage from '@/options/OptionsPage'
import Popup from '@/popup/Popup'
import ToolsApp from '@/tools/ToolsApp'
import AppLogo from '@/ui/AppLogo'

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
  const { t } = useTranslation()

  return (
    <div className='pv'>
      <header className='pv__hero'>
        <h1>
          <AppLogo size={22} />
          {t('preview.title')}
        </h1>
        <p>
          <Trans i18nKey='preview.heroDesc' components={{ code: <code /> }} />
        </p>
      </header>

      <section className='pv__section'>
        <h2 className='pv__section-title'>
          <span className='pv__tag'>Popup</span> {t('preview.popupTitle')}
        </h2>
        <div className='pv__popup-frame'>
          <Popup />
        </div>
      </section>

      <section className='pv__section'>
        <h2 className='pv__section-title'>
          <span className='pv__tag'>Side Panel</span> {t('preview.sidePanelTitle')}
        </h2>
        <div className='pv__tools-frame'>
          <ToolsApp />
        </div>
      </section>

      <section className='pv__section'>
        <h2 className='pv__section-title'>
          <span className='pv__tag'>Options</span> {t('preview.optionsTitle')}
        </h2>
        <OptionsPage />
      </section>

      <section className='pv__section'>
        <h2 className='pv__section-title'>
          <span className='pv__tag'>Content Script</span> {t('preview.contentTitle')}
        </h2>
        <p className='pv__note'>
          <Trans i18nKey='preview.contentNote' components={{ b: <b /> }} />
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
