import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'

import OptionsPage from './OptionsPage'

import '@/theme.css'
import '@/ui/ui.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OptionsPage />
  </StrictMode>,
)
