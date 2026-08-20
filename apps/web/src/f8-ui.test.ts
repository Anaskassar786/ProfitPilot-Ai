import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { JarvisExperience, briefingAllowed, detectSpokenLanguage, extractProposedAction, isCancellation, isConfirmation, resolveNavigationTarget } from './f8.js'
import { statusLabel, orbStateFor } from './JarvisVoiceBar.js'
import type { JarvisPreference } from './f8-model.js'

const preference = (patch: Partial<JarvisPreference> = {}): JarvisPreference => ({
  storeId: 'store-1',
  addressing: 'Sir',
  language: 'auto',
  engagementMode: 'balanced',
  silenceUntil: null,
  navigationSuggestions: true,
  onlyAnswerWhenAsked: false,
  updatedAt: 0,
  ...patch,
})

describe('Jarvis is a voice surface, not a chat window', () => {
  it('renders only the orb launcher when closed', () => {
    const html = renderToStaticMarkup(createElement(JarvisExperience, {
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      page: 'dashboard',
      open: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onToast: vi.fn(),
    }))
    expect(html).toContain('aria-label="Open Jarvis voice assistant"')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('Send message')
  })

  it('ships no chat panel, composer, or transcript in the source', () => {
    const source = readFileSync(new URL('./f8.tsx', import.meta.url), 'utf8')
    for (const removed of ['jarvis-panel', 'jarvis-messages', 'jarvis-composer', 'jarvis-suggestions', 'typing-dots', 'streamJarvisMessage', 'fetchJarvisMessages', 'timelineFromResponse']) {
      expect(source).not.toContain(removed)
    }
    expect(source).toContain('JarvisVoiceBar')
    expect(source).toContain('jarvisVoiceController')
  })

  it('uses a larger orb for the launcher so it reads as a real assistant button', () => {
    const source = readFileSync(new URL('./f8.tsx', import.meta.url), 'utf8')
    expect(source).toContain('size={64}')
    const css = readFileSync(new URL('./f8.css', import.meta.url), 'utf8')
    expect(css).toContain('width: 100px; height: 100px')
    expect(css).toContain('.jarvis-voice-bar')
  })

  it('keeps the voice bar down to three controls: mic, pause, close', () => {
    const source = readFileSync(new URL('./JarvisVoiceBar.tsx', import.meta.url), 'utf8')
    expect(source).toContain('Turn microphone off')
    expect(source).toContain('Pause Jarvis')
    expect(source).toContain('Close Jarvis')
    // No answer text is ever rendered — the merchant hears the reply.
    expect(source).not.toContain('transcript')
  })
})

describe('Jarvis voice bar state labels', () => {
  it('maps voice status to a single spoken-state word', () => {
    expect(statusLabel('listening', true, false)).toBe('Listening')
    expect(statusLabel('processing', true, false)).toBe('Thinking')
    expect(statusLabel('speaking', true, false)).toBe('Speaking')
    expect(statusLabel('idle', false, false)).toBe('Mic off')
    expect(statusLabel('listening', true, true)).toBe('Paused')
  })

  it('drives the orb animation from the same status', () => {
    expect(orbStateFor('listening')).toBe('listening')
    expect(orbStateFor('processing')).toBe('thinking')
    expect(orbStateFor('speaking')).toBe('speaking')
    expect(orbStateFor('paused')).toBe('sleeping')
    expect(orbStateFor('error')).toBe('warning')
  })
})

describe('Page-aware briefings stay helpful, not irritating', () => {
  it('respects quiet, answer-only, and silence preferences', () => {
    const now = 1_000_000
    expect(briefingAllowed(preference(), now)).toBe(true)
    expect(briefingAllowed(preference({ engagementMode: 'quiet' }), now)).toBe(false)
    expect(briefingAllowed(preference({ engagementMode: 'answer-only' }), now)).toBe(false)
    expect(briefingAllowed(preference({ onlyAnswerWhenAsked: true }), now)).toBe(false)
    expect(briefingAllowed(preference({ silenceUntil: now + 60_000 }), now)).toBe(false)
    expect(briefingAllowed(preference({ silenceUntil: now - 1 }), now)).toBe(true)
  })

  it('briefs a page at most once per session and never twice in a minute', () => {
    const source = readFileSync(new URL('./f8.tsx', import.meta.url), 'utf8')
    expect(source).toContain('briefedPages.current.has(page)')
    expect(source).toContain('BRIEFING_COOLDOWN_MS')
  })
})

describe('Spoken action handling', () => {
  it('extracts a proposed action and never speaks the protocol line', () => {
    const parsed = extractProposedAction('I can set that up for you. @jarvis:action {"actionId":"create_automation","parameters":{"template":"abandoned-checkout"}}')
    expect(parsed?.actionId).toBe('create_automation')
    expect(parsed?.parameters.template).toBe('abandoned-checkout')
    expect(parsed?.cleanText).toBe('I can set that up for you.')
    expect(extractProposedAction('Revenue is up today.')).toBeNull()
  })

  it('maps spoken page names to workspace routes', () => {
    expect(resolveNavigationTarget('products')).toBe('products')
    expect(resolveNavigationTarget('Products page')).toBe('products')
    expect(resolveNavigationTarget('workflows')).toBe('automation')
    expect(resolveNavigationTarget('stock')).toBe('inventory')
    expect(resolveNavigationTarget('ai command')).toBe('ai-command')
    expect(resolveNavigationTarget('mars')).toBeNull()
  })

  it('recognises spoken confirmation and cancellation in English and Hinglish', () => {
    expect(isConfirmation('yes please')).toBe(true)
    expect(isConfirmation('haan kar do')).toBe(true)
    expect(isConfirmation('confirm')).toBe(true)
    expect(isCancellation('no, cancel that')).toBe(true)
    expect(isCancellation('nahi rehne do')).toBe(true)
    expect(isConfirmation('what is my revenue')).toBe(false)
  })

  it('answers in the language the merchant spoke', () => {
    expect(detectSpokenLanguage('what is my revenue', 'auto')).toBe('en')
    expect(detectSpokenLanguage('aaj kitna revenue hua', 'auto')).toBe('hi')
    expect(detectSpokenLanguage('मुझे कम स्टॉक दिखाओ', 'auto')).toBe('hi')
    expect(detectSpokenLanguage('kitne orders', 'en')).toBe('en')
  })
})
