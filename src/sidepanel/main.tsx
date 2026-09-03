import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'

import SidePanelPage from './SidePanelPage'

import '@/tools/tools.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanelPage />
  </StrictMode>,
)
