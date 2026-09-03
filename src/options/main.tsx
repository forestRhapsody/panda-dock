import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'

import OptionsPage from './OptionsPage'

import '@/theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OptionsPage />
  </StrictMode>,
)
