import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'

import SidePanelPage from './SidePanelPage'

import '@/theme.css'
import '@/ui/ui.css'
import '@/tools/tools.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanelPage />
  </StrictMode>,
)
