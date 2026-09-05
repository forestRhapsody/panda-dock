import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useLocale } from '@/i18n/useLocale'
import AppLogo from '@/ui/AppLogo'
import Icon from '@/ui/Icon'
import { closeDrawerInActiveTab, openDrawerInActiveTab } from '@/utils/drawer'
import { isExtension, openOptionsPage } from '@/utils/env'
import { useFontScale } from '@/utils/fontScale'
import { closeNativeSidePanel, openNativeSidePanel } from '@/utils/sidePanel'
import { useTheme } from '@/utils/theme'

import QuickSettings from './QuickSettings'

import './index.css'

/** Popup 弹窗界面：顶部工具栏 + 打开工具箱快捷操作 + 快捷设置 */
export default function Popup() {
  const { t } = useTranslation()
  const inExt = isExtension()
  useLocale()
  useFontScale()
  useTheme()
  const [nativeFailed, setNativeFailed] = useState(false)
  const [drawerFailed, setDrawerFailed] = useState(false)

  async function openPanel() {
    // 互斥：先关掉当前页的网页内抽屉，再唤起侧边栏；打开成功后自动关闭本 popup 面板
    await closeDrawerInActiveTab()
    const ok = await openNativeSidePanel()
    setNativeFailed(!ok)
    if (ok) window.close()
  }

  async function openDrawer() {
    // 互斥：先关掉原生侧边栏，再在当前页打开网页内抽屉；打开成功后自动关闭本 popup 面板
    await closeNativeSidePanel()
    const ok = await openDrawerInActiveTab()
    setDrawerFailed(!ok)
    if (ok) window.close()
  }

  return (
    <div className='pop'>
      <header className='pop__header'>
        <span className='pop__title'>
          <AppLogo size={15} />
          Panda Dock
        </span>
        <button
          type='button'
          className='tk-icon-btn'
          title={t('popup.openOptions')}
          aria-label={t('popup.openOptions')}
          onClick={openOptionsPage}
        >
          <Icon name='settings' size={15} />
        </button>
      </header>
      {inExt && (
        <div className='pop__native'>
          <div className='pop__actions'>
            <button
              type='button'
              className='tk-btn tk-btn--primary tk-btn--block'
              onClick={() => void openPanel()}
            >
              <Icon name='panel-right' size={14} />
              {t('popup.openSidePanel')}
            </button>
            <button
              type='button'
              className='tk-btn tk-btn--block'
              onClick={() => void openDrawer()}
            >
              <Icon name='window' size={14} />
              {t('popup.openDrawer')}
            </button>
          </div>
          {nativeFailed && <p className='pop__native-hint'>{t('popup.sidePanelFail')}</p>}
          {drawerFailed && <p className='pop__native-hint'>{t('popup.drawerFail')}</p>}
        </div>
      )}
      <main className='pop__body'>
        <QuickSettings />
      </main>
    </div>
  )
}
