import { describe, expect, it } from 'vitest'
import { canExecuteJarvisActions, canNavigateWithJarvis, inferAutomationTemplate, isEchoOfSpoken, isLikelyBargeIn, isStartupGreeting, jarvisStartupGreeting, parseJarvisVoiceIntent, resolveJarvisSpokenLanguage, spokenReplyText, wantsPageWalkthrough } from './jarvis-intents.js'

describe('Jarvis spoken intents', () => {
  it('treats Trial, Start, and Growth as suggestion-only; Commander can act and navigate', () => {
    expect(canExecuteJarvisActions('commander')).toBe(true)
    expect(canNavigateWithJarvis('commander')).toBe(true)
    expect(canExecuteJarvisActions('growth')).toBe(false)
    expect(canNavigateWithJarvis('growth')).toBe(false)
    expect(canExecuteJarvisActions('start')).toBe(false)
    expect(canExecuteJarvisActions('trial')).toBe(false)
  })

  it('navigates when the merchant asks to be taken to a store page', () => {
    expect(parseJarvisVoiceIntent('Take me to the product page')).toEqual({ type: 'navigate', page: 'products' })
    expect(parseJarvisVoiceIntent('Mujhe inventory pe le jao')).toEqual({ type: 'navigate', page: 'inventory' })
  })

  it('creates a low-stock automation when asked on the automation page', () => {
    const intent = parseJarvisVoiceIntent('Automation bana do for low stock')
    expect(intent).toMatchObject({ type: 'create_automation', templateId: 'low-stock-alert' })
    expect(inferAutomationTemplate('welcome new customers')).toEqual({ id: 'welcome-customer', name: 'Welcome new customer' })
  })

  it('recognizes confirm and cancel for Commander actions', () => {
    expect(parseJarvisVoiceIntent('confirm')).toEqual({ type: 'confirm' })
    expect(parseJarvisVoiceIntent('cancel')).toEqual({ type: 'cancel' })
    expect(parseJarvisVoiceIntent('low stock batao')).toEqual({ type: 'ask', text: 'low stock batao' })
  })

  it('detects when the merchant wants a page walkthrough', () => {
    expect(wantsPageWalkthrough('is page pe kya important hai')).toBe(true)
    expect(wantsPageWalkthrough('tell me about this page')).toBe(true)
    expect(wantsPageWalkthrough('take me to products')).toBe(false)
  })

  it('strips action protocol before speech', () => {
    expect(spokenReplyText('Opening products.\n@jarvis:action {"actionId":"navigate_page","parameters":{"page":"products"}}')).toBe('Opening products.')
  })

  it('resolves spoken language from the selected voice, with Devanagari still flipping a turn to Hindi', () => {
    expect(resolveJarvisSpokenLanguage('hi', 'show revenue')).toBe('hi')
    expect(resolveJarvisSpokenLanguage('en', 'show revenue')).toBe('en')
    expect(resolveJarvisSpokenLanguage('en', 'मुझे बताओ')).toBe('hi')
    expect(resolveJarvisSpokenLanguage('auto', 'kya revenue hai')).toBe('hi')
    expect(resolveJarvisSpokenLanguage('auto', 'show revenue')).toBe('en')
  })

  it('detects startup greetings and barge-in vs echo', () => {
    expect(isStartupGreeting('Hello Sir. Good morning. I\'m Jarvis')).toBe(true)
    expect(isStartupGreeting('Good morning Sir, I\'m Jarvis, your store assistant, how can I help you today?')).toBe(true)
    expect(isStartupGreeting('Namaste Sir, Good evening, main Jarvis hoon')).toBe(true)
    expect(isStartupGreeting('Revenue is up today')).toBe(false)
    expect(isLikelyBargeIn('stop')).toBe(false)
    expect(isLikelyBargeIn('tell me the bad news')).toBe(true)
    expect(isEchoOfSpoken('hello sir', 'Hello Sir. Good morning. I\'m Jarvis, your store assistant.')).toBe(true)
    expect(isEchoOfSpoken('three bad news on analytics', 'Hello Sir. Good morning.')).toBe(false)
  })

  it('opens with a friendly assistant greeting and then waits to help', () => {
    const en = jarvisStartupGreeting('Sir', 'en', new Date('2026-08-20T08:00:00'))
    expect(en).toContain("I'm Jarvis, your store assistant")
    expect(en).toContain('how can I help you today')
    expect(en).toContain('Good morning')
    expect(en.split('.').length).toBe(1)
    expect(en).not.toContain('.')
    const hi = jarvisStartupGreeting("Ma'am", 'hi', new Date('2026-08-20T19:00:00'))
    expect(hi).toContain('kya madad karun')
    expect(hi).toContain('Good evening')
    expect(hi).toContain('Namaste')
    expect(hi.split('.').length).toBe(1)
    expect(hi).not.toContain('.')
  })
})
