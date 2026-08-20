import { describe, expect, it } from 'vitest'
import { canExecuteJarvisActions, inferAutomationTemplate, jarvisStartupGreeting, parseJarvisVoiceIntent, spokenReplyText, wantsPageWalkthrough } from './jarvis-intents.js'

describe('Jarvis spoken intents', () => {
  it('treats Growth and Start as suggestion-only', () => {
    expect(canExecuteJarvisActions('commander')).toBe(true)
    expect(canExecuteJarvisActions('growth')).toBe(false)
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

  it('opens with a friendly assistant greeting and then waits to help', () => {
    expect(jarvisStartupGreeting('Sir', 'en', new Date('2026-08-20T08:00:00'))).toContain("I'm Jarvis, your store assistant")
    expect(jarvisStartupGreeting('Sir', 'en', new Date('2026-08-20T08:00:00'))).toContain('How can I help you today')
    expect(jarvisStartupGreeting('Sir', 'en', new Date('2026-08-20T08:00:00'))).toContain('Good morning')
    expect(jarvisStartupGreeting("Ma'am", 'hi', new Date('2026-08-20T19:00:00'))).toContain('kya madad karun')
    expect(jarvisStartupGreeting("Ma'am", 'hi', new Date('2026-08-20T19:00:00'))).toContain('Good evening')
  })
})
