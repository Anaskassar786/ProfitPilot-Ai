// @vitest-environment jsdom
/**
 * "Open in Shopify" admin deep links (C2) — must never navigate the
 * embedded app iframe. Contract: `target="_blank" rel="noopener
 * noreferrer"` anchor, with the App Bridge navigation API used first when
 * the loaded bridge exposes one (default is then prevented).
 */
import './jsdom-polaris-setup.ts'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }
import { OpenInShopifyLink as OrdersOpenInShopifyLink } from './orders.js'
import { OpenInShopifyLink as InventoryOpenInShopifyLink } from './inventory.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ADMIN_URL = 'https://shop.myshopify.com/admin/orders/123'

let root: Root | null = null
let container: HTMLElement | null = null

function render(element: React.ReactElement): void {
  const node = document.createElement('div')
  document.body.appendChild(node)
  container = node
  root = createRoot(node)
  act(() => {
    root?.render(createElement(AppProvider, { i18n: enTranslations as never }, element))
  })
}

function clickLink(): MouseEvent {
  const anchor = container?.querySelector<HTMLAnchorElement>('a.button.primary')
  expect(anchor).not.toBeNull()
  if (!anchor) throw new Error('link not rendered')
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  act(() => {
    anchor.dispatchEvent(event)
  })
  return event
}

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  delete (window as unknown as { shopify?: unknown }).shopify
})

describe('OpenInShopifyLink (orders)', () => {
  it('renders a new-tab anchor with noopener + noreferrer', () => {
    render(createElement(OrdersOpenInShopifyLink, { href: ADMIN_URL }))
    const anchor = container?.querySelector<HTMLAnchorElement>('a')
    expect(anchor).not.toBeNull()
    if (!anchor) return
    expect(anchor.getAttribute('href')).toBe(ADMIN_URL)
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
    expect(container?.textContent).toContain('Open in Shopify')
  })

  it('lets the anchor open a new tab when no App Bridge navigation is available', () => {
    delete (window as unknown as { shopify?: unknown }).shopify
    render(createElement(OrdersOpenInShopifyLink, { href: ADMIN_URL }))
    const event = clickLink()
    expect(event.defaultPrevented).toBe(false)
  })

  it('defers to App Bridge Navigation.openExternal when the bridge exposes it', () => {
    const openExternal = vi.fn()
    ;(window as unknown as { shopify: unknown }).shopify = { Navigation: { openExternal } }
    render(createElement(OrdersOpenInShopifyLink, { href: ADMIN_URL }))
    const event = clickLink()
    expect(openExternal).toHaveBeenCalledWith({ url: ADMIN_URL })
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('OpenInShopifyLink (inventory)', () => {
  it('renders the same safe anchor contract for product deep links', () => {
    render(createElement(InventoryOpenInShopifyLink, { href: 'https://shop.myshopify.com/admin/products/456' }))
    const anchor = container?.querySelector<HTMLAnchorElement>('a')
    expect(anchor).not.toBeNull()
    if (!anchor) return
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

// The static external-docs link contract (patternai OpenAPI spec) is covered
// by iframe-safe-links.test.ts (node environment).
