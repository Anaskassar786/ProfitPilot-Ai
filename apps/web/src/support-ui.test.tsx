import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HelpSupportPage, SupportPlanCard } from './support.js'
import { SUPPORT_TIERS, commonFaqs, ticketQuota } from './support-model.js'

/**
 * Static-render contracts for the Help & Support redesign. renderToStaticMarkup
 * never runs effects, so this is the honest initial paint: Trial plan (no
 * billing data yet), zero tickets, FAQ strip visible.
 */

const context = { storeId: 'store-1', shop: 'demo.myshopify.com' }
const renderPage = () => renderToStaticMarkup(createElement(HelpSupportPage, { context, onToast: () => {}, onNavigate: () => {}, onNavigateBilling: () => {} }))

describe('Help & Support rename and copy (FIX 1)', () => {
  it('uses merchant-friendly naming — no operator/jargon anywhere', () => {
    const html = renderPage()
    expect(html).toContain('Help &amp; Support')
    expect(html).toContain('Get help from our team. We track every question and respond quickly.')
    expect(html).not.toContain('OPERATOR INBOX')
    expect(html).not.toContain('Operator inbox')
    // The old page *title* must be gone (the quota fact may still say "Support tickets · month").
    expect(html).not.toContain('<h1>Support tickets</h1>')
    expect(html).not.toContain('>Support tickets<')
    expect(html).not.toContain('Status and priority stay auditable')
    expect(html).not.toContain('Duplicate')
    expect(html).not.toContain('SUPPORT INBOX')
    expect(html).not.toContain('auditable')
  })

  it('labels the header with a working "New ticket" action', () => {
    const html = renderPage()
    expect(html).toContain('New ticket')
    expect(html).toContain('HELP CENTER')
  })
})

describe('FAQ / self-help section (FIX 2)', () => {
  it('renders QUICK ANSWERS with the four category cards', () => {
    const html = renderPage()
    expect(html).toContain('QUICK ANSWERS')
    expect(html).toContain('Find help instantly without waiting')
    for (const title of ['Getting Started', 'Billing &amp; Plans', 'AI Features', 'Technical Help']) expect(html).toContain(title)
    expect(html).toContain('Read')
  })

  it('renders the seven expandable common questions collapsed by default', () => {
    const html = renderPage()
    expect(html).toContain('COMMON QUESTIONS')
    for (const entry of commonFaqs()) expect(html).toContain(entry.question)
    // Collapsed by default: answers are not painted until a merchant expands.
    expect(html).not.toContain('Open Dashboard and click')
  })

  it('offers "View all FAQs" to expand the full library', () => {
    const html = renderPage()
    expect(html).toContain('View all FAQs')
  })
})

describe('helpful empty state (FIX 3)', () => {
  it('celebrates "All Clear!" and offers the three fastest help options', () => {
    const html = renderPage()
    expect(html).toContain('All Clear! No open tickets.')
    expect(html).toContain('Your store is running smoothly')
    expect(html).toContain('Need help with something? Choose the fastest option')
    expect(html).toContain('Ask AI Command')
    expect(html).toContain('Browse FAQs')
    expect(html).toContain('New Ticket')
    expect(html).toContain('Instant answers about your store')
    expect(html).toContain('Complex issues need human support')
    expect(html).toContain('AI Command can answer 80% of questions instantly')
  })
})

describe('plan-based support (FIX 4)', () => {
  it('shows the Trial plan status with 0/2 tickets and the 48-hour target', () => {
    const html = renderPage()
    expect(html).toContain('YOUR PLAN')
    expect(html).toContain('Trial')
    expect(html).toContain('0/2 this month')
    expect(html).toContain('48h response target')
    expect(html).toContain('48 hours')
  })

  it('never shows the wrong 24h target for a Trial merchant', () => {
    const html = renderPage()
    // The old page hardcoded a Growth badge; Trial must see 48h everywhere.
    expect(html).not.toContain('24h response target')
    expect(html).not.toContain('Growth response target')
  })

  it('always renders an Upgrade Plan CTA for upgradeable plans', () => {
    const html = renderPage()
    expect(html).toContain('Upgrade Plan')
  })

  it('hides the Upgrade CTA on Commander and congratulates instead', () => {
    const html = renderToStaticMarkup(createElement(SupportPlanCard, { plan: 'commander', quota: ticketQuota([], 'commander'), onUpgrade: () => {} }))
    expect(html).not.toContain('Upgrade Plan')
    expect(html).toContain('You are on the top plan')
    expect(html).toContain('4h Priority response')
    expect(html).toContain('Included')
  })

  it('shows the correct response badge for every plan card', () => {
    for (const plan of ['trial', 'start', 'growth', 'commander'] as const) {
      const html = renderToStaticMarkup(createElement(SupportPlanCard, { plan, quota: ticketQuota([], plan), onUpgrade: () => {} }))
      expect(html).toContain(SUPPORT_TIERS[plan].responseBadge)
    }
  })
})

describe('zero fake data', () => {
  it('does not paint any seeded or demo tickets', () => {
    const html = renderPage()
    expect(html).not.toContain('New merchant question')
    expect(html).toContain('No open support tickets')
  })
})
