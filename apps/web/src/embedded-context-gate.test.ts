import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(join(here, 'App.tsx'), 'utf8')

// ---------------------------------------------------------------------------
// HOTFIX 2 — embedded store-context gating contract.
//
// The app must never show the legacy "Connect Shopify" wall to a merchant who
// opened it from Shopify Admin as an installed embedded app. These source
// contracts lock the rules:
//   • the connect wall derives from a SETTLED bootstrap with NO store and NO
//     known shop — never from empty analytics or a missing local cache;
//   • the "No Shopify store context detected" banner and "No store context"
//     labels are gone;
//   • the legacy install modal only renders for the genuinely-uninstalled
//     state;
//   • session expiry surfaces as a single Polaris banner, not stacked toasts.
// ---------------------------------------------------------------------------

describe('embedded store-context gating (HOTFIX 2)', () => {
  it('derives the connect wall from bootstrap state, not from analytics', () => {
    expect(appSource).toContain("const showConnect = authState === 'ready' && !context.storeId && !context.shop")
    // The old failure mode: connect whenever analytics is empty. Must be gone.
    expect(appSource).not.toContain('!analytics || revenue === 0')
  })

  it('gates the install banner and the legacy modal on showConnect', () => {
    expect(appSource).toContain('{showConnect && <ContextBanner')
    expect(appSource).toContain('{showConnect && onboardingOpen && <OnboardingModal')
  })

  it('removes the false "No Shopify store context detected" banner copy', () => {
    expect(appSource).not.toContain('No Shopify store context detected')
    expect(appSource).not.toContain("'No store context'")
  })

  it('keeps the single session-expired Polaris banner and never a toast for it', () => {
    expect(appSource).toContain('<Banner tone="critical" title="Session expired"')
    expect(appSource).toContain("setSessionError('Your Shopify session expired — reload the app to reconnect.')")
    // The handler used to call showToast for session expiry — now the banner.
    expect(appSource).not.toContain("showToast('Your Shopify session expired")
  })

  it('waits for the App Bridge token before the first bootstrap fetch', () => {
    expect(appSource).toContain('await warmUpEmbeddedSessionToken()')
    expect(appSource).toContain('fetchSessionContext(query)')
  })

  it('keeps the dashboard greeting for installed stores whose context is pending', () => {
    // The connect title is reserved for the truly-uninstalled state.
    expect(appSource).toContain(": showConnect\n      ? 'Connect your Shopify store'")
  })
})
