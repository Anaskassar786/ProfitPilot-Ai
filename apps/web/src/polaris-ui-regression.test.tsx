// @vitest-environment jsdom
/**
 * Polaris migration UI regression guard.
 *
 * The `Button` shim (polaris-ui.tsx) flattens children into a Polaris icon +
 * string label, which used to corrupt composite controls:
 *   - filter tabs rendered the label twice (`All Items` icon + `All Items27`
 *     text) and locked cards rendered one concatenated soup
 *     (`Dead Stock DetectorUpgrade to unlock`).
 * These tests pin the fixed DOM contracts so the double-label / concatenation
 * regressions cannot return.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// jsdom does not implement matchMedia; Polaris' breakpoints module calls it at
// import time. Polyfill (unconditionally — jsdom stubs the property) before
// importing the modules under test so Polaris evaluates cleanly.
;(window as unknown as { matchMedia: (query: string) => unknown }).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})

type RichButtonModule = typeof import('./polaris-ui.js')
type OrdersModule = typeof import('./orders.js')
let RichButton: RichButtonModule['RichButton']
let PlanLockedFeature: OrdersModule['PlanLockedFeature']

beforeAll(async () => {
  const polarisUi = await import('./polaris-ui.js')
  const orders = await import('./orders.js')
  RichButton = polarisUi.RichButton
  PlanLockedFeature = orders.PlanLockedFeature
})

describe('Polaris migration: composite controls keep their structure', () => {
  it('filter tabs render one label plus a separate count, never a duplicated label', () => {
    const html = renderToStaticMarkup(
      createElement(
        RichButton,
        { className: 'active', role: 'tab', 'aria-selected': true, onClick: vi.fn() },
        createElement('span', null, 'All Items'),
        createElement('strong', null, '27'),
      ),
    )
    expect(html).toContain('<span>All Items</span><strong>27</strong>')
    expect(html).not.toContain('All ItemsAll Items')
    expect(html).not.toContain('All Items27')
    expect(html).toContain('class="active"')
  })

  it('locked features keep the feature name, tagline, and CTA as separate nodes', () => {
    const html = renderToStaticMarkup(
      createElement(PlanLockedFeature, { featureName: 'Dead Stock Detector', requiredPlan: 'growth', onUpgrade: vi.fn(), children: createElement('span', null, 'mask') }),
    )
    expect(html).toContain('class="plan-locked-feature"')
    expect(html).toContain('<span class="plan-locked-blur"')
    expect(html).toContain('<strong>Dead Stock Detector</strong>')
    expect(html).toContain('<small>Upgrade to unlock</small>')
    expect(html).toContain('class="plan-locked-cta"')
    // The label is one clean string, not a mashed-together run of words.
    expect(html).not.toContain('DetectorUpgrade')
    expect(html).toContain('aria-label="Upgrade to unlock Dead Stock Detector"')
  })

  it('Commander-locked features carry the plan-specific tagline', () => {
    const html = renderToStaticMarkup(
      createElement(PlanLockedFeature, { featureName: 'Predictive Restocking', requiredPlan: 'commander', onUpgrade: vi.fn(), children: createElement('span', null, 'mask') }),
    )
    expect(html).toContain('<small>Upgrade to Commander to unlock</small>')
    expect(html).not.toContain('RestockingUpgrade')
  })

  it('template cards are never built from one concatenated text node', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps/web/src/TemplateGallery.tsx'), 'utf8')
    // The card body must be a rich-content button that keeps its children.
    expect(source).toContain('<RichButton className="template-card-main"')
    expect(source).toContain('<h3 className="template-name">')
    expect(source).toContain('<p className="template-description">')
    // The card footer CTA must keep its classes so it stays aligned and styled.
    expect(source).toContain('<RichButton className="set-up-mini template-setup-btn"')
    expect(source).toContain('<RichButton className="upgrade-mini template-upgrade-btn upgrade-plan-btn"')
  })

  it('all double-label filter tab renderers use the rich-content button', () => {
    const inventory = readFileSync(resolve(process.cwd(), 'apps/web/src/inventory.tsx'), 'utf8')
    const orders = readFileSync(resolve(process.cwd(), 'apps/web/src/orders.tsx'), 'utf8')
    const automation = readFileSync(resolve(process.cwd(), 'apps/web/src/automation.tsx'), 'utf8')
    const recommendations = readFileSync(resolve(process.cwd(), 'apps/web/src/recommendations.tsx'), 'utf8')
    expect(inventory).toContain('<RichButton key={tab.id} role="tab"')
    expect(orders).toContain('<RichButton key={tab.id} role="tab"')
    expect(automation).toContain('<RichButton key={value} className={`filter-tab')
    expect(recommendations).toContain('<RichButton key={tab} role="tab"')
  })
})
