import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AiCommandWorkspace } from './ai-command.js'

describe('AI Command UI', () => {
  it('renders the empty welcome state without voice controls', () => {
    const html = renderToStaticMarkup(createElement(AiCommandWorkspace, {
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
    const html = renderToStaticMarkup(createElement(AiCommandWorkspace, {
      context: { storeId: null, shop: null },
      plan: 'trial',
      onToast: vi.fn(),
      onNavigateBilling: vi.fn(),
    }))
    expect(html).toContain('Connect Shopify to open AI Command')
    expect(html).not.toContain('$8,940')
  })
})
