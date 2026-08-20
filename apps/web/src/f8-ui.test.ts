import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { JarvisExperience } from './f8.js'

describe('Jarvis voice-strip UI', () => {
  it('renders the orb launcher instead of a chat panel when closed', () => {
    const html = renderToStaticMarkup(createElement(JarvisExperience, {
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      page: 'dashboard',
      open: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onEvidence: vi.fn(),
      onToast: vi.fn(),
    }))
    expect(html).toContain('Open Jarvis')
    expect(html).not.toContain('Ask Jarvis')
    expect(html).not.toContain('Message Jarvis')
    expect(html).not.toContain('<textarea')
  })

  it('does not mount a chatbot composer or message timeline', () => {
    const source = readFileSync(new URL('./f8.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('jarvis-panel')
    expect(source).not.toContain('jarvis-composer')
    expect(source).not.toContain('jarvis-messages')
    expect(source).not.toContain('jarvis-voice-inline')
    expect(source).toContain('FloatingVoiceWidget')
    expect(source).toContain('toggleMic')
    expect(source).toContain('onNavigate')
  })

  it('keeps the animated orb and starts voice from the launcher click', () => {
    const source = readFileSync(new URL('./f8.tsx', import.meta.url), 'utf8')
    expect(source).toContain('JarvisOrb')
    expect(source).toContain('size={80}')
    expect(source).toContain('beginVoice')
    expect(source).toContain('jarvisVoiceController.unlock')
    expect(source).toContain('fetchJarvisBriefing')
  })

  it('renders the floating strip when open so chat is not required', () => {
    const source = readFileSync(new URL('./f8.tsx', import.meta.url), 'utf8')
    expect(source).toContain('micOn={voice.active && !paused}')
    expect(source).toContain("onClose={closeJarvis}")
    expect(source).toContain('parseJarvisVoiceIntent')
  })
})
