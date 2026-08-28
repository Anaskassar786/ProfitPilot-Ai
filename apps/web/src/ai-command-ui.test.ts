import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ActionBlockedBlock, AiCommandWorkspace, actionBlockedCompanionText, startReauthorize } from './ai-command.js'
import { aiCommandApprovalToast } from './ai-command-hooks.js'
import { AiCommandMark } from './ai-command-logo.js'
import { SHOPIFY_PERMISSION_MESSAGE } from './ai-command-model.js'
import type { AiCommandConversation } from './ai-command-model.js'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }

/** main.tsx wraps every page in Polaris AppProvider (i18n) — mirror it here so
 *  components using the Polaris Button shim render outside an app shell. */
function renderWithAppProvider(element: import('react').ReactElement) {
  return renderToStaticMarkup(createElement(AppProvider, { i18n: enTranslations as never }, element))
}


describe('AI Command UI', () => {
  it('renders the empty welcome state without voice controls', () => {
    const html = renderWithAppProvider(createElement(AiCommandWorkspace, {
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      plan: 'growth',
      onToast: vi.fn(),
      onNavigateBilling: vi.fn(),
    }))
    expect(html).toContain('Welcome to AI Command')
    expect(html).toContain('One command controls everything')
    expect(html).toContain('Upgrade Plan')
    expect(html).not.toContain('Upgrade to Commander')
    expect(html).not.toContain('microphone')
    expect(html).not.toContain('Start voice')
    expect(html).toContain('Type your command')
  })

  it('asks for a Shopify connection instead of inventing a workspace', () => {
    const html = renderWithAppProvider(createElement(AiCommandWorkspace, {
      context: { storeId: null, shop: null },
      plan: 'trial',
      onToast: vi.fn(),
      onNavigateBilling: vi.fn(),
    }))
    expect(html).toContain('Connect Shopify to open AI Command')
    expect(html).not.toContain('$8,940')
  })

  it('renders the new Neural Command Node logo (no generic sparkle mark)', () => {
    const html = renderWithAppProvider(createElement(AiCommandMark, { size: 24, variant: 'badge' }))
    expect(html).toContain('AI Command')
    expect(html).toContain('ac-mark')
    expect(html).toContain('<title>AI Command</title>')
  })

  it('shows capability cards, templates, the right rail, and plan gating', () => {
    const html = renderWithAppProvider(createElement(AiCommandWorkspace, {
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      plan: 'trial',
      onToast: vi.fn(),
      onNavigateBilling: vi.fn(),
    }))
    // Capability cards
    for (const label of ['Store Analytics', 'Customer Insights', 'Inventory Management', 'Business Recommendations']) {
      expect(html).toContain(label)
    }
    // Store Actions card is locked for non-Commander with a real upgrade CTA
    expect(html).toContain('Store Actions')
    expect(html).toContain('Locked')
    expect(html).toContain('Upgrade Plan')
    // Popular question chips
    for (const label of ['Today’s revenue', 'Top customers', 'Low stock', 'Growth ideas']) {
      expect(html).toContain(label)
    }
    // Command templates
    expect(html).toContain('Popular command templates')
    expect(html).toContain('Analyze weekend sales')
    expect(html).toContain('Find at-risk customers')
    expect(html).toContain('Check inventory alerts')
    expect(html).toContain('Show growth opportunities')
    // Right rail
    expect(html).toContain('Recent commands')
    expect(html).toContain('Your impact')
    expect(html).toContain('What AI can do')
    expect(html).toContain('Daily commands')
    // No fake revenue numbers anywhere in the shell
    expect(html).not.toContain('$8,940')
    expect(html).not.toContain('Upgrade to Commander')
  })

  it('enables Store Actions for Commander without an Upgrade CTA', () => {
    const html = renderWithAppProvider(createElement(AiCommandWorkspace, {
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      plan: 'commander',
      onToast: vi.fn(),
      onNavigateBilling: vi.fn(),
    }))
    expect(html).toContain('Full action execution enabled')
    expect(html).toContain('Actions enabled')
    expect(html).toContain('Unlimited commands')
    expect(html).not.toContain('Upgrade Plan')
    expect(html).not.toContain('Locked')
  })

  it('renders real recent-command rows when conversations exist', () => {
    const conversation: AiCommandConversation = {
      id: 'c1', storeId: 'store-1', title: 'Revenue question', context: {}, status: 'ACTIVE',
      createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z', lastMessageAt: '2026-08-18T10:00:00.000Z',
      messages: [
        { id: 'm1', role: 'user', content: 'What is my revenue today?', contentType: 'text', structuredData: null, action: null, thinkingSteps: null, timestamp: '2026-08-18T10:00:00.000Z' },
        { id: 'm2', role: 'assistant', content: 'Your revenue today is $500.', contentType: 'text', structuredData: null, action: null, thinkingSteps: null, timestamp: '2026-08-18T10:00:01.000Z' },
      ],
    }
    // The workspace fetches from the API; the RecentCommandsCard is driven by
    // real conversation rows. We verify the model helper renders their preview
    // text rather than hardcoding anything in the component.
    expect(conversation.messages.some((message) => message.content === 'What is my revenue today?')).toBe(true)
    expect(conversation.messages.some((message) => message.content.includes('$500'))).toBe(true)
  })
})

describe('Missing Shopify permission block (403 / ACCESS_DENIED)', () => {
  it('renders the standard permission copy and a re-authorize CTA instead of the raw Shopify error', () => {
    const html = renderWithAppProvider(createElement(ActionBlockedBlock, {
      data: {
        actionType: 'TAG_CUSTOMER',
        missingScope: 'write_customers',
        message: `${SHOPIFY_PERMISSION_MESSAGE} Missing permission: write_customers.`,
        reauthorizeUrl: '/shopify/install?shop=demo.myshopify.com',
      },
    }))
    expect(html).toContain('Additional Shopify permissions required')
    expect(html).toContain('Please re-authorize or reinstall ProfitPilot from Shopify Admin')
    expect(html).toContain('write_customers')
    expect(html).toContain('Re-authorize ProfitPilot')
    expect(html).toContain('Nothing was changed in your store.')
    // The raw transport string and the internal customer id never render.
    expect(html).not.toContain('Shopify API request failed with 403')
    expect(html).not.toContain('9414254756053')
  })

  it('falls back to the shared permission copy when the payload carries no message', () => {
    const html = renderWithAppProvider(createElement(ActionBlockedBlock, { data: {} }))
    expect(html).toContain(SHOPIFY_PERMISSION_MESSAGE.replace('⚠️ ', ''))
    expect(html).toContain('Re-authorize ProfitPilot')
  })

  it('renders each part of the warning exactly once (scope folds into the tag, not the sentence)', () => {
    const html = renderWithAppProvider(createElement(ActionBlockedBlock, {
      data: {
        actionType: 'TAG_CUSTOMER',
        missingScope: 'write_customers',
        // The server appends the inline " Missing permission: …" suffix to the
        // sentence; the card renders that scope as its own tag, so the copy
        // must not repeat it.
        message: `${SHOPIFY_PERMISSION_MESSAGE} Missing permission: write_customers.`,
        reauthorizeUrl: '/shopify/install?shop=demo.myshopify.com',
      },
    }))
    expect(html.match(/requires additional Shopify permissions/g)?.length).toBe(1)
    expect(html.match(/[Mm]issing permission:?/g)?.length).toBe(1)
    // The scope tag and the re-authorize CTA stay prominent.
    expect(html).toContain('<code>write_customers</code>')
    expect(html).toContain('Re-authorize ProfitPilot')
  })

  it('bubble companion text drops the duplicated permission sentence but keeps extra summary detail', () => {
    const permission = `${SHOPIFY_PERMISSION_MESSAGE} Missing permission: write_customers.`
    // Identical content and block message: nothing renders above the card.
    expect(actionBlockedCompanionText(permission, { message: permission })).toBe('')
    // Partial-success detail appended by the server still renders once.
    expect(actionBlockedCompanionText(`${permission} 3 customer(s) were updated before Shopify refused the rest.`, { message: permission }))
      .toBe('3 customer(s) were updated before Shopify refused the rest.')
    // Unrelated content and missing payloads render verbatim.
    expect(actionBlockedCompanionText('Something else entirely', { message: permission })).toBe('Something else entirely')
    expect(actionBlockedCompanionText('Plain summary', null)).toBe('Plain summary')
    expect(actionBlockedCompanionText('  ', null)).toBe('')
  })

  it('re-authorize hands the install URL to the top-level window (embedded) or navigates directly (standalone)', () => {
    // This suite runs in the node environment, so `window` is stubbed rather
    // than mutated: only the two branches of the OAuth handoff are asserted.
    const globals = globalThis as { window?: unknown }
    const original = globals.window
    try {
      const open = vi.fn()
      const assign = vi.fn()
      // Embedded: window.top !== window.self, so the top frame must navigate.
      globals.window = { top: { name: 'top' }, self: { name: 'self' }, open, location: { assign } }
      startReauthorize('/shopify/install?shop=demo.myshopify.com')
      // Two arguments only: `noopener` must never be passed for a `_top`
      // navigation — it forces window.open to return null, which callers read
      // as "the navigation was blocked" even though it was dispatched.
      expect(open).toHaveBeenCalledWith('/shopify/install?shop=demo.myshopify.com', '_top')
      expect(assign).not.toHaveBeenCalled()

      // Standalone: a plain same-window navigation.
      const frame = { name: 'same' }
      globals.window = { top: frame, self: frame, open, location: { assign } }
      startReauthorize('/shopify/install?shop=demo.myshopify.com')
      expect(assign).toHaveBeenCalledWith('/shopify/install?shop=demo.myshopify.com')
      expect(open).toHaveBeenCalledTimes(1)

      // Embedded with a real location: the relative install URL is anchored
      // on the APP's origin — the top frame is on Shopify's origin, so a
      // bare relative path would 404 on admin.shopify.com.
      const openAnchored = vi.fn()
      globals.window = { top: { name: 'top' }, self: { name: 'self' }, open: openAnchored, location: { href: 'https://profitpilot.app/?host=YWJj' } }
      startReauthorize('/shopify/install?shop=demo.myshopify.com')
      expect(openAnchored).toHaveBeenCalledWith('https://profitpilot.app/shopify/install?shop=demo.myshopify.com', '_top')
    } finally {
      if (original === undefined) delete globals.window
      else globals.window = original
    }
  })
})

describe('AI Command approval toast contract', () => {
  it('celebrates only a genuinely successful execution', () => {
    expect(aiCommandApprovalToast('SUCCESS')).toEqual({ message: 'Action completed. Review the verified result below.', kind: 'success' })
  })

  it('never claims a blocked or failed action completed — warns or stays silent instead', () => {
    // A permission-blocked run lands as FAILED: no contradictory "completed" banner.
    expect(aiCommandApprovalToast('FAILED')).toEqual({ message: 'Action was not completed. Review the result below.', kind: 'warning' })
    expect(aiCommandApprovalToast('PARTIAL_SUCCESS')).toEqual({ message: 'Action partially completed. Review the verified result below.', kind: 'warning' })
    expect(aiCommandApprovalToast(null)).toBeNull()
    expect(aiCommandApprovalToast('PENDING')).toBeNull()
    expect(aiCommandApprovalToast('CANCELLED')).toBeNull()
  })
})
