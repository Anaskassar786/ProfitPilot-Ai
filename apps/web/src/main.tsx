import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.js'
import './styles.css'
import './f4.css'
import './f5.css'
import './f6.css'
import './f8.css'
import './jarvis-orb.css'
import './f9.css'
import './dashboard.css'
import './orders.css'
import './customers.css'
import './inventory.css'
import './analytics.css'
import './automation.css'
import './command-center.css'
import './ai-command.css'
import './store-coach.css'
import './recommendations.css'
import './patternai.css'
import './support.css'
import './exports.css'
import './upgrade-overrides.css'
import './final-polish.css'
// Loaded last: AI Command Center light-theme surfaces only (dark theme untouched).
import './command-center-light.css'
import './settings.css'
import { accessibilityGateEnabled, installAccessibilityGate } from './accessibility.js'

const root = document.getElementById('root')
if (!root) throw new Error('ProfitPilot root element is missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void installAccessibilityGate(document.body, accessibilityGateEnabled(window.location.search)).catch((error: unknown) => {
  document.documentElement.dataset.accessibilityGate = 'failed'
  console.error(error)
})
