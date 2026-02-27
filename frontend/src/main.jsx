
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import MvpApp from './MvpApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MvpApp />
  </StrictMode>,
)
