import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { readBrowserAppearance } from './lib/desktop'

document.documentElement.dataset.appearance =
  window.wintermute?.initialAppearance ?? readBrowserAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
