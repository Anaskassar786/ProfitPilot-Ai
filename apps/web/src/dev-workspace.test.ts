import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isDeveloperWorkspaceWith } from './dev-workspace.js'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

describe('developer workspace gate (Admin Ops / Phase 2 reminders)', () => {
  it('is NOT a developer workspace for a regular merchant in a production build', () => {
    expect(isDeveloperWorkspaceWith({ DEV: false }, { shop: 'merchant-store.myshopify.com' })).toBe(false)
    expect(isDeveloperWorkspaceWith({}, { shop: 'merchant-store.myshopify.com' })).toBe(false)
    expect(isDeveloperWorkspaceWith({ DEV: false }, { shop: null })).toBe(false)
  })

  it('is a developer workspace in a local Vite dev build', () => {
    expect(isDeveloperWorkspaceWith({ DEV: true }, { shop: null })).toBe(true)
    expect(isDeveloperWorkspaceWith({ DEV: true }, { shop: 'merchant-store.myshopify.com' })).toBe(true)
  })

  it('recognises the app owner store via VITE_ADMIN_SHOP_DOMAIN (case/whitespace tolerant)', () => {
    const env = { DEV: false, VITE_ADMIN_SHOP_DOMAIN: ' ProfitPilot-Dev.myshopify.com ' }
    expect(isDeveloperWorkspaceWith(env, { shop: 'profitpilot-dev.myshopify.com' })).toBe(true)
    expect(isDeveloperWorkspaceWith(env, { shop: 'another-merchant.myshopify.com' })).toBe(false)
    expect(isDeveloperWorkspaceWith(env, { shop: null })).toBe(false)
  })

  it('never matches when VITE_ADMIN_SHOP_DOMAIN is empty or blank', () => {
    expect(isDeveloperWorkspaceWith({ DEV: false, VITE_ADMIN_SHOP_DOMAIN: '' }, { shop: 'store.myshopify.com' })).toBe(false)
    expect(isDeveloperWorkspaceWith({ DEV: false, VITE_ADMIN_SHOP_DOMAIN: '   ' }, { shop: 'store.myshopify.com' })).toBe(false)
  })
})

describe('sidebar navigation cleanup', () => {
  it('marks Admin Ops as devOnly and filters it through visibleNavGroups', () => {
    expect(appSource).toMatch(/id: 'admin-ops',\s*label: 'Admin Ops',\s*icon: ShieldCheck,\s*devOnly: true/)
    expect(appSource).toContain('function visibleNavGroups(')
    expect(appSource).toContain('.filter((item) => !item.devOnly)')
  })

  it('carries no amateur nav badges (AI / NEW / Automate / Reports / Plans tags are gone)', () => {
    expect(appSource).not.toMatch(/tag:\s*'(AI|NEW|Automate|Reports|Plans|Admin)'/)
    expect(appSource).not.toMatch(/badge:\s*'NEW'/)
    expect(appSource).not.toContain('nav-tag')
    expect(appSource).not.toContain('collapsed-badge')
  })

  it('uses the Sparkles icon for Recommendations in nav and page meta', () => {
    expect(appSource).toMatch(/id: 'recommendations', label: 'Recommendations', icon: Sparkles/)
    expect(appSource).not.toContain('WandSparkles')
  })

  it('shows the dev-only amber Phase 2 dot on Billing with the pending-checkout tooltip', () => {
    expect(appSource).toContain('nav-dev-dot')
    expect(appSource).toContain('Real Shopify Checkout pending (Phase 2)')
    expect(appSource).toMatch(/item\.id === 'billing' && devWorkspace/)
  })

  it('renders a professional connection card instead of dev jargon', () => {
    expect(appSource).toContain('Shopify Connected')
    expect(appSource).toContain('Synced · All systems active')
    expect(appSource).not.toContain('API-backed workspace')
    expect(appSource).not.toContain('Store context ready')
  })

  it('keeps the Billing page dev note gated behind the developer workspace check', () => {
    expect(appSource).toMatch(/devWorkspace && !devNoteDismissed/)
    expect(appSource).toContain('Billing is currently in mock mode. Phase 2 (Real Shopify Checkout) is pending.')
  })
})
