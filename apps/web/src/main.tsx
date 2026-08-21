import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }
import '@shopify/polaris/build/esm/styles.css'
import App from './App.js'
import './styles.css'
import './f4.css'
import './f5.css'
import './billing.css'
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
import './qa-board.css'
import './command-center-light.css'
import './settings.css'
import './light-theme-professional-fix.css'
import { accessibilityGateEnabled, installAccessibilityGate } from './accessibility.js'
import { AppBridgeProvider, AppFrame } from './polaris-ui.js'
import { embeddedHost } from './shopify-app-bridge.js'

const root = document.getElementById('root')
if (!root) throw new Error('ProfitPilot root element is missing')

const host = embeddedHost(window.location.search)

createRoot(root).render(
  <StrictMode>
    <AppProvider i18n={enTranslations as never}>
      <AppBridgeProvider forceRedirect host={host}>
        <AppFrame>
          <App />
        </AppFrame>
      </AppBridgeProvider>
    </AppProvider>
  </StrictMode>,
)

void installAccessibilityGate(document.body, accessibilityGateEnabled(window.location.search)).catch((error: unknown) => {
  document.documentElement.dataset.accessibilityGate = 'failed'
  console.error(error)
})
