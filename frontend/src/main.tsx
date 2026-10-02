import '@fontsource-variable/plus-jakarta-sans'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthGate } from './components/AuthGate'
import { SharedTranslationPage } from './components/SharedTranslationPage'
import './index.css'

// Share links (/s/<id>) open a public read-only page; the translator needs an account.
const shareId = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/)?.[1]

createRoot(document.getElementById('root')!).render(
  <StrictMode>{shareId ? <SharedTranslationPage shareId={shareId} /> : <AuthGate />}</StrictMode>,
)
