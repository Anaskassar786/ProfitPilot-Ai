import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { JarvisNavIcon, JarvisWorkspace } from './jarvis-page.js'

describe('Jarvis workspace page', () => {
  it('centers the speaking orb and keeps chat out of the page', () => {
    const html = renderToStaticMarkup(createElement(JarvisWorkspace, {
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      onListen: vi.fn(),
    }))
    expect(html).toContain('Tap the orb to speak')
    expect(html).toContain('Page-aware')
    expect(html).toContain('Commander actions')
    expect(html).toContain('Jarvis settings')
    expect(html).toContain('English · Female')
    expect(html).toContain('English · Male')
    expect(html).toContain('Hindi · Female')
    expect(html).toContain('Hindi · Male')
    expect(html).toContain('Four voices')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('Ask Jarvis')
  })

  it('applies the 4-voice picker immediately via setJarvisVoiceProfile without waiting for Save', () => {
    const source = readFileSync(new URL('./jarvis-page.tsx', import.meta.url), 'utf8')
    expect(source).toContain('setJarvisVoiceProfile({ language: option.language, gender: option.gender })')
    expect(source).toContain('writeWorkspaceSettings')
    expect(source).not.toMatch(/setVoiceLanguage\(next\.language\)/)
  })

  it('renders a compact nav mark', () => {
    const html = renderToStaticMarkup(createElement(JarvisNavIcon, { size: 17 }))
    expect(html).toContain('viewBox="0 0 24 24"')
  })
})
