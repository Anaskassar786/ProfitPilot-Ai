import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.js'
import './styles.css'
import './f4.css'
import './f5.css'
import './f6.css'

const root = document.getElementById('root')
if (!root) throw new Error('ProfitPilot root element is missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
