// @vitest-environment jsdom
/**
 * Settings — complete functional sweep.
 * Every tab, button, toggle, and confirmation is exercised against mocked
 * real APIs. No fake store metrics are introduced.
 */
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './settings.js'
import { DEFAULT_WORKSPACE_SETTINGS, settingsStorageKey } from './settings-model.js'
import type { WorkspaceContext } from './model.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const toasts: string[] = []
const billingNavigations: string[] = []
const consoleErrors: string[] = []
let root: Root | null = null
let savedEmail: { shopId: string; email: string; fromName: string } | null = null
let workspaceSaved: Record<string, unknown> | null = null
let jarvisSaved: Record<string, unknown> | null = null
let verified = false
let coachPatchFails = false
let jarvisPutFails = false

function json(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ ok: true, data }),
  } as Response)
}

function jsonError(message: string, status = 500): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message } }),
  } as Response)
}

function setupFetch() {
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.startsWith('/security/csrf')) return json({ csrfToken: 'test-csrf' })
    if (url.startsWith('/billing?')) return json({ subscription: { plan: 'START', state: 'ACTIVE', currentPeriodEnd: Date.parse('2026-09-01'), version: 1 }, trial: null, gift: null })
    if (url.startsWith('/sync/status')) return json({ storeId: 's1', shopDomain: 'commander-pilot.myshopify.com', registered: true, hasAccessToken: true, circuit: null, canSync: true })
    if (url.startsWith('/settings/merchant-email') && method === 'GET') {
      return json(savedEmail ? { shopId: savedEmail.shopId, merchantEmail: savedEmail.email, fromName: savedEmail.fromName, verified, verificationSentAt: Date.now(), verifiedAt: verified ? Date.now() : null } : null)
    }
    if (url.startsWith('/settings/merchant-email/verify') && method === 'POST') {
      verified = true
      return json({ verified: true })
    }
    if (url.startsWith('/settings/merchant-email') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { shopId: string; email: string; fromName: string }
      savedEmail = body
      verified = false
      return json({ config: body, verificationToken: 's1|merchant@example.com|1|sig', verificationRequired: true, emailSent: true })
    }
    if (url.startsWith('/settings/workspace') && method === 'PUT') {
      workspaceSaved = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return json(workspaceSaved)
    }
    if (url.startsWith('/settings/workspace')) return json({ storeId: 's1', ...DEFAULT_WORKSPACE_SETTINGS })
    if (url.startsWith('/jarvis/preferences') && method === 'PUT') {
      if (jarvisPutFails) return jsonError('jarvis save failed')
      jarvisSaved = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return json({ storeId: 's1', addressing: 'Sir', language: 'en', engagementMode: 'balanced', silenceUntil: null, navigationSuggestions: true, onlyAnswerWhenAsked: false, updatedAt: Date.now() })
    }
    if (url.startsWith('/jarvis/preferences')) return json({ storeId: 's1', addressing: 'Sir', language: 'en', engagementMode: 'balanced', silenceUntil: null, navigationSuggestions: true, onlyAnswerWhenAsked: false, updatedAt: Date.now() })
    if (url.startsWith('/store-coach/preferences') && method === 'PATCH') {
      if (coachPatchFails) return jsonError('coach save failed')
      return json({ storeId: 's1', personality: 'PROFESSIONAL', huddleTimeMinutes: 420, huddleEnabled: true, weeklyEmailEnabled: false, voiceEnabled: false, widgetEnabled: true, language: 'en', notificationFrequency: 'NORMAL', updatedAt: Date.now(), plan: 'start' })
    }
    if (url.startsWith('/store-coach/preferences')) return json({ storeId: 's1', personality: 'PROFESSIONAL', huddleTimeMinutes: 420, huddleEnabled: true, weeklyEmailEnabled: false, voiceEnabled: false, widgetEnabled: true, language: 'en', notificationFrequency: 'NORMAL', updatedAt: Date.now(), plan: 'start' })
    if (url.startsWith('/ai-command/preferences') && method === 'PATCH') return json({ storeId: 's1', defaultResponseStyle: 'CONCISE', quickCommandsEnabled: true, autoSuggestionsEnabled: true, thinkingAnimationEnabled: true, conversationMemoryEnabled: true, notificationOnActionComplete: true })
    if (url.startsWith('/ai-command/preferences')) return json({ storeId: 's1', defaultResponseStyle: 'CONCISE', quickCommandsEnabled: true, autoSuggestionsEnabled: true, thinkingAnimationEnabled: true, conversationMemoryEnabled: true, notificationOnActionComplete: true })
    if (url.startsWith('/exports')) return json({ filename: 'audit.csv', contentType: 'text/csv', bodyBase64: btoa('action,created_at\n'), rows: 0 })
    return json({})
  })
}

describe('Settings complete functional testing', () => {
  const originalError = console.error

  beforeEach(() => {
    toasts.length = 0
    billingNavigations.length = 0
    consoleErrors.length = 0
    savedEmail = null
    workspaceSaved = null
    jarvisSaved = null
    verified = false
    coachPatchFails = false
    jarvisPutFails = false
    try { window.localStorage.clear() } catch { /* jsdom */ }
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '))
      originalError.apply(console, args)
    }
    setupFetch()
  })

  afterEach(() => {
    if (root) {
      act(() => { root?.unmount() })
      root = null
    }
    console.error = originalError
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function mount(lightMode = false, storeId: string | null = 's1') {
    const container = document.createElement('div')
    container.className = `app-shell ${lightMode ? 'light-mode' : ''}`
    document.body.appendChild(container)
    const context = { shop: storeId ? 'commander-pilot.myshopify.com' : null, storeId } as WorkspaceContext
    await act(async () => {
      root = createRoot(container)
      root.render(
        <StrictMode>
          <SettingsPage
            context={context}
            lightMode={lightMode}
            onTheme={() => undefined}
            onToast={(message) => toasts.push(message)}
            onNavigateBilling={() => billingNavigations.push('billing')}
          />
        </StrictMode>,
      )
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    return container
  }

  function fillInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function tabButton(container: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('.settings-nav-item')).find((item) => item.textContent?.includes(label)) as HTMLButtonElement | undefined
    if (!button) throw new Error(`Missing tab ${label}`)
    return button
  }

  describe('1. Page load and sidebar', () => {
    it('loads General in dark and light without console errors', async () => {
      const dark = await mount(false)
      expect(dark.querySelector('.settings-page')).toBeTruthy()
      expect(dark.textContent).toContain('Manage your store preferences, notifications, and account')
      expect(dark.textContent).toContain('AI Preferences')
      expect(dark.textContent).not.toContain('Jarvis preferences')
      expect(dark.textContent).not.toContain('WORKSPACE CONTROLS')
      expect(consoleErrors).toHaveLength(0)
      await act(async () => { root?.unmount(); root = null })
      const light = await mount(true)
      expect(light.querySelector('.settings-page')).toBeTruthy()
      expect(consoleErrors).toHaveLength(0)
    })

    it('navigates all six tabs and highlights the active one', async () => {
      const container = await mount(true)
      for (const label of ['Notifications', 'AI Preferences', 'Team Members', 'Security', 'Danger Zone', 'General']) {
        await act(async () => { tabButton(container, label).click() })
        expect(tabButton(container, label).className).toContain('active')
      }
    })
  })

  describe('2. General tab', () => {
    it('shows the real Shopify store as a clickable admin link and hides fabricated names', async () => {
      const container = await mount(true)
      expect(container.textContent).toContain('commander-pilot.myshopify.com')
      expect(container.textContent).not.toContain('No store name is fabricated')
      const link = container.querySelector('.setting-store-link') as HTMLAnchorElement | null
      expect(link?.href).toContain('commander-pilot.myshopify.com/admin')
      expect(container.textContent).toContain('s1')
    })

    it('saves and verifies merchant email against the backend', async () => {
      const container = await mount(true)
      const email = container.querySelector('input[placeholder="merchant@example.com"]') as HTMLInputElement
      const from = container.querySelector('input[placeholder="Your store"]') as HTMLInputElement
      await act(async () => {
        fillInput(email, 'merchant@example.com')
        fillInput(from, 'Commander')
      })
      const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Save and verify')) as HTMLButtonElement
      await act(async () => { save.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(savedEmail).toEqual({ shopId: 's1', email: 'merchant@example.com', fromName: 'Commander' })
      expect(toasts.some((toast) => toast.includes('Verification email sent'))).toBe(true)
      expect(container.textContent).toContain('Pending verification')
      const confirm = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Confirm verification')) as HTMLButtonElement
      await act(async () => { confirm.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(verified).toBe(true)
      expect(container.textContent).toContain('Verified')
    })

    it('saves appearance preferences so they persist on reload', async () => {
      const container = await mount(false)
      const reduced = container.querySelector('[aria-label="Reduced motion"]') as HTMLButtonElement
      await act(async () => { reduced.click() })
      const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save preferences') as HTMLButtonElement
      await act(async () => { save.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(toasts).toContain('Preferences saved.')
      const stored = JSON.parse(window.localStorage.getItem(settingsStorageKey('s1')) ?? '{}') as { reducedMotion?: boolean }
      expect(stored.reducedMotion).toBe(true)
      expect(workspaceSaved && workspaceSaved.reducedMotion).toBe(true)
    })
  })

  describe('3. Notifications tab', () => {
    it('toggles notification rows and saves them', async () => {
      const container = await mount(true)
      await act(async () => { tabButton(container, 'Notifications').click() })
      expect(container.textContent).toContain('Weekly AI digest')
      expect(container.textContent).toContain('New discoveries')
      const digest = container.querySelector('[aria-label="Weekly AI digest"]') as HTMLButtonElement
      expect(digest.getAttribute('aria-checked')).toBe('true')
      await act(async () => { digest.click() })
      expect(digest.getAttribute('aria-checked')).toBe('false')
      const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Save notification preferences')) as HTMLButtonElement
      await act(async () => { save.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(toasts).toContain('Notification preferences saved.')
      const stored = JSON.parse(window.localStorage.getItem(settingsStorageKey('s1')) ?? '{}') as { notifications?: { weeklyAiDigest?: boolean } }
      expect(stored.notifications?.weeklyAiDigest).toBe(false)
    })
  })

  describe('4. AI Preferences tab', () => {
    it('changes assistant mode and saves AI preferences', async () => {
      const container = await mount(true)
      await act(async () => { tabButton(container, 'AI Preferences').click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      /* 🛑 Jarvis section temporarily hidden — 'Floating assistant (Jarvis)' not visible */
      expect(container.textContent).toContain('Store Coach personality')
      const quiet = Array.from(container.querySelectorAll('.settings-choice')).find((button) => button.textContent?.includes('Quiet')) as HTMLButtonElement
      await act(async () => { quiet.click() })
      const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save AI preferences') as HTMLButtonElement
      await act(async () => { save.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(toasts).toContain('AI preferences saved.')
      expect(jarvisSaved && jarvisSaved.engagementMode).toBe('quiet')
      const stored = JSON.parse(window.localStorage.getItem(settingsStorageKey('s1')) ?? '{}') as { assistantMode?: string }
      expect(stored.assistantMode).toBe('quiet')
    })

    it('does not claim success when a secondary AI server save fails (500)', async () => {
      coachPatchFails = true
      const container = await mount(true)
      await act(async () => { tabButton(container, 'AI Preferences').click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save AI preferences') as HTMLButtonElement
      await act(async () => { save.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(toasts.some((toast) => toast.includes('AI preferences saved.'))).toBe(false)
      expect(toasts.some((toast) => toast.includes('could not be saved right now'))).toBe(true)
      // The workspace save still landed locally so the page state is not lost.
      const stored = JSON.parse(window.localStorage.getItem(settingsStorageKey('s1')) ?? '{}') as { assistantMode?: string }
      expect(stored.assistantMode).toBe('balanced')
    })

    it('surfaces a hard error when the core Jarvis save fails', async () => {
      jarvisPutFails = true
      const container = await mount(true)
      await act(async () => { tabButton(container, 'AI Preferences').click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save AI preferences') as HTMLButtonElement
      await act(async () => { save.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(toasts.some((toast) => toast.includes('AI preferences saved.'))).toBe(false)
      expect(toasts.some((toast) => toast.includes('jarvis save failed'))).toBe(true)
    })
  })

  describe('5. Team Members tab', () => {
    it('shows the connected owner and plan-gates invites on Start', async () => {
      const container = await mount(true)
      await act(async () => { tabButton(container, 'Team Members').click() })
      expect(container.textContent).toContain('Commander Pilot (Owner)')
      expect(container.textContent).toContain('Coming soon')
      const upgrade = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Upgrade Plan'))
      expect(upgrade).toBeTruthy()
      await act(async () => { upgrade?.click() })
      expect(billingNavigations).toContain('billing')
    })
  })

  describe('6. Security tab', () => {
    it('shows real connection status and exports without inventing events', async () => {
      const container = await mount(true)
      await act(async () => { tabButton(container, 'Security').click() })
      expect(container.textContent).toContain('Shopify OAuth: Connected')
      expect(container.textContent).toContain('Data encryption: Active')
      expect(container.textContent).toContain('No recent security events')
      expect(container.textContent).toContain('PII is never shared with AI models')
      const audit = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('View full audit log')) as HTMLButtonElement
      await act(async () => { audit.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(toasts.length).toBeGreaterThan(0)
    })
  })

  describe('7. Danger Zone', () => {
    it('requires confirmation before clearing AI data', async () => {
      window.localStorage.setItem('profitpilot:jarvis:dismissed:s1', '["rec-1"]')
      const container = await mount(true)
      await act(async () => { tabButton(container, 'Danger Zone').click() })
      expect(container.textContent).toContain('These actions are irreversible')
      const clear = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Clear AI data') as HTMLButtonElement
      await act(async () => { clear.click() })
      expect(document.querySelector('.settings-modal')).toBeTruthy()
      const confirm = Array.from(document.querySelectorAll('.settings-modal button')).find((button) => button.textContent === 'Clear AI data') as HTMLButtonElement
      await act(async () => { confirm.click() })
      expect(window.localStorage.getItem('profitpilot:jarvis:dismissed:s1')).toBeNull()
      expect(toasts.some((toast) => toast.includes('Shopify data is unchanged'))).toBe(true)
    })

    it('requires typing the store domain before disconnect', async () => {
      const container = await mount(true)
      await act(async () => { tabButton(container, 'Danger Zone').click() })
      const disconnect = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Disconnect') as HTMLButtonElement
      await act(async () => { disconnect.click() })
      const confirm = Array.from(document.querySelectorAll('.settings-modal button')).find((button) => button.textContent === 'Disconnect') as HTMLButtonElement
      expect(confirm.disabled).toBe(true)
      const input = document.querySelector('.settings-modal input') as HTMLInputElement
      await act(async () => { fillInput(input, 'commander-pilot.myshopify.com') })
      expect(confirm.disabled).toBe(false)
    })
  })
})
