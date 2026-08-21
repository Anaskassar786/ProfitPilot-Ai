// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

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

describe('App Bridge navigation chrome', () => {
  let AppNavigationMenu: typeof import('./polaris-ui.js').AppNavigationMenu
  let NAV_DESTINATIONS: typeof import('./polaris-ui.js').NAV_DESTINATIONS
  let showAppBridgeToast: typeof import('./polaris-ui.js').showAppBridgeToast

  beforeAll(async () => {
    const module = await import('./polaris-ui.js')
    AppNavigationMenu = module.AppNavigationMenu
    NAV_DESTINATIONS = module.NAV_DESTINATIONS
    showAppBridgeToast = module.showAppBridgeToast
  })

  it('passes destinations through ui-nav-menu instead of a visible sidebar', () => {
    const html = renderToStaticMarkup(createElement(AppNavigationMenu))
    expect(html).toContain('ui-nav-menu')
    expect(html).toContain('data-pp-app-bridge-nav')
    expect(html).toContain('rel="home"')
    expect(html).toContain('Dashboard')
    expect(html).toContain('AI Command Center')
    expect(html).toContain('Recommendations')
    expect(html).toContain('Automation')
    expect(html).toContain('href="/ai-growth-command/coach"')
    expect(html).not.toContain('side-nav')
    expect(html).not.toContain('class="sidebar')
    expect(NAV_DESTINATIONS.some((item) => item.label === 'PatternAI')).toBe(true)
  })

  it('does not dual-dispatch a Polaris toast when App Bridge toast is available', () => {
    const show = vi.fn()
    const events: Event[] = []
    ;(window as unknown as { shopify: { toast: { show: typeof show } } }).shopify = { toast: { show } }
    const onToast = (event: Event) => { events.push(event) }
    window.addEventListener('profitpilot:toast', onToast)
    showAppBridgeToast('Your Shopify session expired — reload the app to reconnect.', 'error')
    window.removeEventListener('profitpilot:toast', onToast)
    expect(show).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith('Your Shopify session expired — reload the app to reconnect.', { isError: true, duration: 5000 })
    expect(events).toHaveLength(0)
    delete (window as unknown as { shopify?: unknown }).shopify
  })
})
