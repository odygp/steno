import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import TranscriptionWindow from './TranscriptionWindow'
import Widget from './Widget'
import './index.css'

const hash = window.location.hash

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {hash === '#transcription' ? <TranscriptionWindow /> : hash === '#widget' ? <Widget /> : <App />}
  </StrictMode>
)
