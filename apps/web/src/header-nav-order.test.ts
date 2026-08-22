// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Locks the merchant-approved 18-tab header navigation sequence (GA 2026-08-21).
 * The exact order is a contract for the Shopify App Store review — Analytics,
 * Exports, and Help & Support must exist, and both AI Command Center and
 * AI Commander must be visible as separate tabs.
 */
const EXPECTED: readonly Readonly<{ label: string; page: string }>[] = [
  { label: 'Dashboard', page: 'dashboard' },
  { label: 'Products', page: 'products' },
  { label: 'Orders', page: 'orders' },
  { label: 'Customers', page: 'customers' },
  { label: 'Inventory', page: 'inventory' },
  { label: 'Analytics', page: 'analytics' },
  { label: 'AI Center', page: 'command-center' },
  { label: 'AI Commander', page: 'ai-command' },
  { label: 'Recommendations', page: 'recommendations' },
  { label: 'GrowthIQ', page: 'ai-executive' },
  { label: 'Automation', page: 'automation' },
  { label: 'Store Coach', page: 'store-coach' },
  { label: 'PatternAI', page: 'patternai' },
  { label: 'Reports', page: 'reports' },
  { label: 'Exports', page: 'exports' },
  { label: 'Billing', page: 'billing' },
  { label: 'Help & Support', page: 'support' },
  { label: 'Settings', page: 'settings' },
]

describe('header navigation order (GA 2026-08-21)', () => {
  const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const navBlock = source.slice(source.indexOf('const HEADER_NAV'), source.indexOf('function HeaderNavigation'))

  it('ships the exact 18-tab merchant-approved sequence', () => {
    for (const tab of EXPECTED) {
      expect(navBlock).toContain(`{ label: '${tab.label}', page: '${tab.page}' }`)
    }
    const entries = [...navBlock.matchAll(/\{ label: '([^']+)', page: '([^']+)' \}/g)].map((match) => ({ label: match[1], page: match[2] }))
    expect(entries).toEqual(EXPECTED)
    expect(entries).toHaveLength(18)
  })

  it('never renders dev/hidden pages in the header', () => {
    expect(navBlock).not.toContain('admin-ops')
    expect(navBlock).not.toContain('qa-board')
    expect(navBlock).not.toContain('jarvis')
  })

  it('wires header tabs to the client-side SPA navigator, never <a href> anchors', () => {
    const tabRender = source.slice(source.indexOf('function HeaderNavigation'), source.indexOf('function HeaderNavigation') + 1200)
    expect(tabRender).toContain("onClick={() => onNavigate(item.page)}")
    expect(tabRender).not.toMatch(/<a[^>]*href=/)
  })

  it('uses theme tokens in the header bar so dark mode follows the Shopify Admin theme', () => {
    const css = readFileSync(new URL('./header-navigation.css', import.meta.url), 'utf8')
    expect(css).toContain('var(--p-color-bg-surface)')
    expect(css).toContain('var(--p-color-border)')
    expect(css).toContain('var(--p-color-text-brand)')
    expect(css).not.toMatch(/background:\s*#(fff|FFF|FFFFFF)/)
    expect(css).not.toMatch(/background:\s*white/)
  })
})
