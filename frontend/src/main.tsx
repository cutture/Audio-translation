import '@fontsource-variable/plus-jakarta-sans'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SharedTranslationPage } from './components/SharedTranslationPage'
import './index.css'

// Share links (/s/<id>) open a read-only page; everything else is the translator.
const shareId = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/)?.[1]

createRoot(document.getElementById('root')!).render(
  <StrictMode>{shareId ? <SharedTranslationPage shareId={shareId} /> : <App />}</StrictMode>,
)
