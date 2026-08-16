import { readFileSync } from 'node:fs'
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
  it('removes the live strip, evidence confidence link, and duplicate voice warnings', () => {
    const source = readFileSync(new URL('./f8.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('jarvis-live-strip')
    expect(source).not.toContain('evidence-link')
    expect(source).not.toContain('confidence} confidence')
    expect(source).not.toContain('Voice unavailable · chat active')
    expect(source).not.toContain('Voice unavailable · chat ready')
    expect(source).toContain('typing-dots')
    expect(source).toContain('streamJarvisMessage')
    expect(source).toContain('Mute Jarvis')
  })

  it('keeps chat mounted during inline voice and isolates microphone errors from session lifecycle', () => {
    const source = readFileSync(new URL('./f8.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('jarvis-immersive')
    expect(source).toContain('jarvis-voice-inline')
    expect(source).toContain("role: 'merchant'")
    // Voice now runs through the shared controller so a microphone error never
    // tears down the chat session lifecycle.
    expect(source).toContain('jarvisVoiceController')
    expect(source).not.toContain('setVoiceError')
    expect(source).not.toContain('createSpeechRecognition')
  })

  it('renders the floating background voice widget so voice survives panel close', () => {
    const source = readFileSync(new URL('./f8.tsx', import.meta.url), 'utf8')
    expect(source).toContain('FloatingVoiceWidget')
    // The widget is rendered on the closed branch too (not only when open).
    const closedBranch = source.slice(source.indexOf('if (!open)'))
    expect(closedBranch).toContain('floatingWidget')
  })
})
