import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import TranscriptionWindow from './TranscriptionWindow'
import './index.css'

const isTranscription = window.location.hash === '#transcription'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTranscription ? <TranscriptionWindow /> : <App />}
  </StrictMode>
)
