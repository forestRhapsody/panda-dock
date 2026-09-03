import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'

import Popup from './Popup'

import '@/theme.css'
import '@/ui/ui.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
)
