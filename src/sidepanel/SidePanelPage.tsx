import { useTranslation } from 'react-i18next'

import { useLocale } from '@/i18n/useLocale'
import ToolsApp from '@/tools/ToolsApp'
import { isExtension } from '@/utils/env'
import { useFontScale } from '@/utils/fontScale'
import { closeNativeSidePanel } from '@/utils/sidePanel'
import { useTheme } from '@/utils/theme'

import './index.css'

/**
 * 浏览器原生侧边栏(Side Panel)页面。
 * 内容与网页内抽屉共用同一套 <ToolsApp/> 工具箱。
 */
export default function SidePanelPage() {
  const { t } = useTranslation()
  const inExt = isExtension()
  useLocale()
  useFontScale()
  useTheme()

  return (
    <div className='sp'>
      <ToolsApp
        headerActions={
          inExt && (
            <button
              type='button'
              className='tk-btn tk-btn--sm'
              title={t('sidepanel.collapse-sidebar')}
              onClick={() => void closeNativeSidePanel()}
            >
              {t('sidepanel.collapse')}
            </button>
          )
        }
      />
    </div>
  )
}
