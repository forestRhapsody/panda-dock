import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'

import SidePanelPage from './SidePanelPage'

import '@/theme.css'
import '@/ui/ui.css'
import '@/tools/tools.css'
import './index.css'

const container = document.getElementById('root')
if (!container) {
  // 入口 HTML 必然带 #root；缺失时给出可读提示，避免 createRoot(null) 抛裸 TypeError、白屏且无迹可查
  console.error('[PandaDock] #root container not found; side panel was not mounted')
} else {
  createRoot(container).render(
    <StrictMode>
      <SidePanelPage />
    </StrictMode>,
  )
}
