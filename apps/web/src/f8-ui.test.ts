import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { JarvisExperience } from './f8.js'

describe('Jarvis readiness UI', () => {
  it('renders explicit startup guidance and disables chat and voice before ready', () => {
    const html = renderToStaticMarkup(createElement(JarvisExperience, {
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      page: 'dashboard',
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onEvidence: vi.fn(),
      onToast: vi.fn(),
    }))
    expect(html).toContain('Jarvis is starting…')
    expect(html).toContain('Chat and voice will unlock when your secure session is ready.')
    expect(html).toMatch(/<textarea[^>]*disabled=""/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Start voice input"/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Send message"/)
    expect(html).toContain('aria-busy="true"')
  })
})
