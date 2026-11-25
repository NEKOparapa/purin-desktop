import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DesktopPet } from './components/desktop-pet'
import { readBrowserAppearance } from './lib/desktop'

document.documentElement.dataset.appearance =
  window.purin?.initialAppearance ?? readBrowserAppearance()
if (window.purinPet) {
  document.documentElement.dataset.window = 'pet'
  document.title = 'Purin 桌宠'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.purinPet ? <DesktopPet api={window.purinPet} /> : <App />}
  </StrictMode>,
)
