import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DesktopPet } from './components/desktop-pet'
import { readBrowserAppearance } from './lib/desktop'

document.documentElement.dataset.appearance =
  window.wintermute?.initialAppearance ?? readBrowserAppearance()
if (window.wintermutePet) {
  document.documentElement.dataset.window = 'pet'
  document.title = 'Wintermute 桌宠'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.wintermutePet ? <DesktopPet api={window.wintermutePet} /> : <App />}
  </StrictMode>,
)
