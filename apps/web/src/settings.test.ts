// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  SETTINGS_TABS,
  assistantModeFromEngagement,
  clearWorkspaceAiData,
  confirmationMatchesStore,
  defaultWorkspaceSettings,
  emailVerificationState,
  engagementFromAssistantMode,
  formatSecurityDate,
  isEmailValid,
  isSettingsTab,
  mergeWorkspaceSettings,
  ownerDisplayName,
  parseWorkspaceSettings,
  planFromBilling,
  quietHoursSilenceUntil,
  readWorkspaceSettings,
  settingsStorageKey,
  shopifyAdminUrl,
  shopifyAppsUrl,
  teamInviteAllowed,
  verificationBadge,
  writeWorkspaceSettings,
} from './settings-model.js'

describe('Settings model', () => {
  afterEach(() => {
    try { window.localStorage.clear() } catch { /* jsdom storage */ }
  })

  it('keeps all six merchant-facing tabs including the renamed AI Preferences', () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual(['general', 'notifications', 'ai', 'team', 'security', 'danger'])
    expect(SETTINGS_TABS.find((tab) => tab.id === 'ai')?.label).toBe('AI Preferences')
    expect(SETTINGS_TABS.every((tab) => isSettingsTab(tab.id))).toBe(true)
    expect(isSettingsTab('jarvis')).toBe(false)
  })

  it('validates merchant email without inventing an address', () => {
    expect(isEmailValid('merchant@example.com')).toBe(true)
    expect(isEmailValid('not-an-email')).toBe(false)
    expect(isEmailValid('')).toBe(false)
  })

  it('maps verification badge states honestly', () => {
    expect(emailVerificationState({ email: '', verified: false, pending: false })).toBe('unconfigured')
    expect(emailVerificationState({ email: 'a@b.com', verified: false, pending: false })).toBe('required')
    expect(emailVerificationState({ email: 'a@b.com', verified: false, pending: true })).toBe('pending')
    expect(emailVerificationState({ email: 'a@b.com', verified: true, pending: true })).toBe('verified')
    expect(verificationBadge('verified')).toEqual({ label: 'Verified', tone: 'green' })
    expect(verificationBadge('pending').label).toBe('Pending verification')
  })

  it('derives plan and team gating from real billing, defaulting to trial', () => {
    expect(planFromBilling(null)).toBe('trial')
    expect(planFromBilling({ subscription: { plan: 'GROWTH', state: 'ACTIVE', currentPeriodEnd: null, version: 1 }, trial: null, gift: null })).toBe('growth')
    expect(teamInviteAllowed('trial')).toBe(false)
    expect(teamInviteAllowed('start')).toBe(false)
    expect(teamInviteAllowed('growth')).toBe(true)
    expect(teamInviteAllowed('commander')).toBe(true)
  })

  it('builds Shopify admin URLs only from a real shop domain', () => {
    expect(shopifyAdminUrl(null)).toBeNull()
    expect(shopifyAdminUrl('commander-pilot.myshopify.com')).toBe('https://commander-pilot.myshopify.com/admin')
    expect(shopifyAppsUrl('commander-pilot.myshopify.com')).toBe('https://commander-pilot.myshopify.com/admin/settings/apps')
  })

  it('maps assistant modes onto Jarvis engagement without inventing a fourth mode', () => {
    expect(engagementFromAssistantMode('active')).toBe('proactive')
    expect(engagementFromAssistantMode('quiet')).toBe('quiet')
    expect(assistantModeFromEngagement('proactive')).toBe('active')
    expect(assistantModeFromEngagement('answer-only')).toBe('quiet')
    expect(assistantModeFromEngagement('balanced')).toBe('balanced')
  })

  it('persists workspace settings per store and reloads them', () => {
    const next = mergeWorkspaceSettings(defaultWorkspaceSettings(), { reducedMotion: true, notifications: { ...defaultWorkspaceSettings().notifications, weeklyAiDigest: false } })
    writeWorkspaceSettings('store-1', next)
    const loaded = readWorkspaceSettings('store-1')
    expect(loaded.reducedMotion).toBe(true)
    expect(loaded.notifications.weeklyAiDigest).toBe(false)
    expect(settingsStorageKey('store-1')).toContain('store-1')
  })

  it('parses unknown payloads into safe defaults instead of fabricating values', () => {
    const parsed = parseWorkspaceSettings({ theme: 'neon', bubblePosition: 'top', jarvisVoiceGender: 'masculine', notifications: { weeklyAiDigest: false } })
    expect(parsed.theme).toBe('dark')
    expect(parsed.bubblePosition).toBe('bottom-right')
    expect(parsed.jarvisVoiceGender).toBe('masculine')
    expect(parsed.notifications.weeklyAiDigest).toBe(false)
    expect(parsed.notifications.securityAlerts).toBe(true)
  })

  it('requires the exact store domain before a disconnect can proceed', () => {
    expect(confirmationMatchesStore('commander-pilot.myshopify.com', 'commander-pilot.myshopify.com')).toBe(true)
    expect(confirmationMatchesStore('other.myshopify.com', 'commander-pilot.myshopify.com')).toBe(false)
    expect(confirmationMatchesStore('yes', null)).toBe(false)
  })

  it('computes quiet-hours silence only when the window is active', () => {
    const noon = new Date('2026-08-18T12:00:00').getTime()
    const night = new Date('2026-08-18T23:00:00').getTime()
    const settings = { ...defaultWorkspaceSettings(), quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' }
    expect(quietHoursSilenceUntil(settings, noon)).toBeNull()
    expect(quietHoursSilenceUntil(settings, night)).toBeGreaterThan(night)
    expect(quietHoursSilenceUntil({ ...settings, quietHoursEnabled: false }, night)).toBeNull()
  })

  it('never invents a last-authenticated date from unusable input', () => {
    expect(formatSecurityDate(null)).toBeNull()
    expect(formatSecurityDate('not-a-date')).toBeNull()
    expect(formatSecurityDate(Date.parse('2026-08-18T00:00:00Z'))).toContain('2026')
  })

  it('derives owner copy from the real shop handle', () => {
    expect(ownerDisplayName('commander-pilot.myshopify.com')).toBe('Commander Pilot')
    expect(ownerDisplayName(null)).toBe('Store owner')
  })

  it('clears only this store’s local AI keys', () => {
    window.localStorage.setItem('profitpilot:jarvis:dismissed:store-1', '["a"]')
    window.localStorage.setItem('profitpilot:jarvis:dismissed:other', '["b"]')
    const cleared = clearWorkspaceAiData('store-1')
    expect(cleared.some((key) => key.includes('store-1'))).toBe(true)
    expect(window.localStorage.getItem('profitpilot:jarvis:dismissed:other')).toBe('["b"]')
  })
})
