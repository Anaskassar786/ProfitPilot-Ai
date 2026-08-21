// @vitest-environment jsdom
import './jsdom-polaris-setup.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Polaris touches window.matchMedia at module evaluation, so it is imported
// lazily after the shim above is installed (same pattern as nav-chrome.test).
let AppNavigationMenu: typeof import('./polaris-ui.js').AppNavigationMenu

beforeAll(async () => {
  const module = await import('./polaris-ui.js')
  AppNavigationMenu = module.AppNavigationMenu
})

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(join(here, 'App.tsx'), 'utf8')
const apiSource = readFileSync(join(here, 'api.ts'), 'utf8')
const polarisUiSource = readFileSync(join(here, 'polaris-ui.tsx'), 'utf8')
const coachWidgetSource = readFileSync(join(here, 'coach-widget.tsx'), 'utf8')

// ---------------------------------------------------------------------------
// HOTFIX 3 — false "Session expired" banner + sluggish tab navigation.
//
// Contract locks:
//   • the fetcher silently retries a 401 with a FRESH App Bridge idToken and
//     only a 401 that survives the retry may latch the session banner;
//   • any 2xx clears a latched banner (auto-clear);
//   • the bootstrap context is cached globally so tab switching/remounts
//     never re-run the boot loading sequence;
//   • header tabs and the App Bridge `ui-nav-menu` anchors route CLIENT-SIDE
//     (no full-page/iframe hard reloads);
//   • banners render inside a Polaris Layout.Section (app shell sits in a
//     Polaris Frame) and keep onDismiss.
// ---------------------------------------------------------------------------

describe('HOTFIX 3 — silent 401 retry in the central fetcher', () => {
  it('awaits a fresh idToken before every request and retries a 401 exactly once', () => {
    expect(apiSource).toContain('await attachEmbeddedSessionToken(headers)')
    expect(apiSource).toContain('if (response.status === 401 && allowRetry && !callerAuthorization)')
    // The retry mints a brand-new token instead of reusing the stale bearer.
    expect(apiSource).toContain('const fresh = await getShopifySessionToken()')
    expect(apiSource).toContain("retryHeaders.set('authorization', `Bearer ${fresh.token}`)")
  })

  it('latches the session banner only when the retry also fails with 401', () => {
    expect(apiSource).toContain('if (response.status === 401) notifyEmbeddedAuthFailure()')
    expect(apiSource).toContain('throw failureFromPayload(payload, response.status)')
  })

  it('auto-clears the latch on every successful response', () => {
    expect(apiSource).toContain('notifyEmbeddedAuthRecovered()')
    expect(apiSource).toContain('export function setEmbeddedAuthRecoveryHandler')
  })

  it('never raises the banner from token mint races at boot', () => {
    // The warm-up waits for the bridge but stays silent; the request outcome
    // (401-after-retry) is the only thing allowed to surface the banner.
    expect(apiSource).toContain('await getShopifySessionTokenWithRetry()')
    expect(apiSource).not.toContain('embeddedAuthFailureHandler?.(result.message)')
  })
})

describe('HOTFIX 3 — auto-clear + cached bootstrap in the app shell', () => {
  it('registers the recovery handler that clears the session banner', () => {
    expect(appSource).toContain('setEmbeddedAuthRecoveryHandler(() => setSessionError(null))')
    expect(appSource).toContain('setEmbeddedAuthFailureHandler(null)')
  })

  it('caches the bootstrap store context globally and reuses it', () => {
    expect(appSource).toContain('let embeddedBootstrapCache')
    expect(appSource).toContain('const cached = readEmbeddedBootstrapCache(urlContext.shop)')
    expect(appSource).toContain('rememberEmbeddedBootstrapCache(urlContext.shop, result)')
  })

  it('clears a false session banner when bootstrap and page data succeed', () => {
    expect(appSource).toContain('// The session is valid — clear any false session-expired latch')
    expect(appSource).toContain("if (nextLoadState === 'ready' || nextLoadState === 'partial') setSessionError(null)")
  })

  it('renders the banner region inside a Polaris Layout.Section', () => {
    expect(appSource).toContain('import { Banner, Layout, Page } from \'@shopify/polaris\'')
    expect(appSource).toContain('<Layout>')
    expect(appSource).toContain('<Layout.Section>')
  })

  it('keeps onDismiss on the session-expired banner', () => {
    expect(appSource).toContain('<Banner tone="critical" title="Session expired" onDismiss={onDismiss}>')
  })

  it('header tabs are SPA buttons, never hard-navigation anchors', () => {
    // HeaderNavigation renders buttons wired to the client-side navigate.
    const headerNavStart = appSource.indexOf('function HeaderNavigation')
    const headerNavEnd = appSource.indexOf('</nav>', headerNavStart)
    const headerNavBody = appSource.slice(headerNavStart, headerNavEnd)
    expect(headerNavBody).toContain('<button')
    expect(headerNavBody).toContain("className={`header-navigation-tab")
    // The tab itself must never be an anchor that hard-navigates.
    expect(headerNavBody).not.toMatch(/<a[^>]*header-navigation-tab/)
    expect(headerNavBody).not.toContain('window.location.href')
  })

  it('wires the App Bridge nav menu to the SPA router', () => {
    expect(appSource).toContain('<AppNavigationMenu onNavigate={(section) => navigate(section as SectionId)} />')
  })

  it('routes the floating Coach widget client-side instead of hard-reloading', () => {
    // "Open Store Coach" from the widget is a tab switch too — it must go
    // through the SPA router, never a bare href navigation.
    expect(coachWidgetSource).toContain('event.preventDefault()')
    expect(coachWidgetSource).toContain('onNavigate?')
    expect(appSource).toContain('onNavigate={() => navigate(\'store-coach\')}')
  })
})

describe('HOTFIX 3 — App Bridge nav menu clicks route client-side', () => {
  it('intercepts anchor clicks instead of hard-navigating the iframe', () => {
    expect(polarisUiSource).toContain('event.preventDefault()')
    expect(polarisUiSource).toContain("onNavigate?.(section)")
    expect(polarisUiSource).toContain("data-section={item.section}")
  })

  let root: Root | null = null

  afterEach(() => {
    root?.unmount()
    root = null
    document.body.innerHTML = ''
  })

  it('calls the SPA navigator for a click and leaves the URL untouched (no reload)', async () => {
    const onNavigate = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(AppNavigationMenu, { onNavigate }))
    })
    const automation = document.querySelector('ui-nav-menu a[data-section="automation"]')
    expect(automation).not.toBeNull()
    expect(automation?.getAttribute('href')).toBe('/automation') // App Bridge still needs hrefs
    const before = window.location.href
    await act(async () => {
      automation!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(onNavigate).toHaveBeenCalledWith('automation')
    // Client-side routing: no document navigation happened.
    expect(window.location.href).toBe(before)
  })

  it('keeps the home anchor so App Bridge can configure the home route', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(AppNavigationMenu))
    })
    const home = document.querySelector('ui-nav-menu a[rel="home"]')
    expect(home?.getAttribute('href')).toBe('/')
    expect(home?.getAttribute('data-section')).toBe('dashboard')
  })
})
