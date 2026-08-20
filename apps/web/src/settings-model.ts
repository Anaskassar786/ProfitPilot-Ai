/**
 * Settings workspace model. Pure types and persistence helpers — no fetching
 * lives here. Appearance and notification state persist locally so a reload
 * keeps the merchant's choices even when the network is down. Backend saves
 * (email, Jarvis, coach, AI Command) are layered on top by the page.
 */

import type { BillingAccount } from './model.js'
import type { JarvisEngagementMode } from './f8-model.js'
import type { CoachPersonality } from './store-coach-model.js'

export type SettingsTab = 'general' | 'notifications' | 'ai' | 'team' | 'security' | 'danger'
export type WorkspacePlan = 'trial' | 'start' | 'growth' | 'commander'
export type BubblePosition = 'bottom-right' | 'bottom-left'
export type AssistantMode = 'active' | 'balanced' | 'quiet'
export type ResponseStyle = 'CONCISE' | 'DETAILED' | 'TECHNICAL'
export type JarvisVoiceGender = 'feminine' | 'masculine'
export type JarvisVoiceLanguage = 'en' | 'hi'
export type EmailVerificationState = 'unconfigured' | 'required' | 'pending' | 'verified'

export type NotificationPreferences = Readonly<{
  weeklyAiDigest: boolean
  recommendationAlerts: boolean
  goalAchievements: boolean
  securityAlerts: boolean
  newDiscoveries: boolean
  priorityAlerts: boolean
}>

export type WorkspaceSettings = Readonly<{
  theme: 'dark' | 'light'
  reducedMotion: boolean
  notifications: NotificationPreferences
  bubbleEnabled: boolean
  bubblePosition: BubblePosition
  assistantMode: AssistantMode
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  responseStyle: ResponseStyle
  autoSuggestions: boolean
  jarvisVoiceGender: JarvisVoiceGender
  jarvisLanguage: JarvisVoiceLanguage
}>

export type MerchantEmailView = Readonly<{
  shopId: string
  merchantEmail: string
  fromName: string
  verified: boolean
  verificationSentAt: number | null
  verifiedAt: number | null
}>

export type MerchantEmailSaveResult = Readonly<{
  config: Readonly<Record<string, unknown>>
  verificationToken?: string
  verificationRequired?: boolean
  emailSent?: boolean
}>

export const SETTINGS_EVENT = 'profitpilot:workspace-settings'
export const SETTINGS_STORAGE_PREFIX = 'profitpilot:settings:workspace:'

export const SETTINGS_TABS: readonly Readonly<{ id: SettingsTab; label: string; danger?: boolean }>[] = [
  { id: 'general', label: 'General' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'ai', label: 'AI Preferences' },
  { id: 'team', label: 'Team Members' },
  { id: 'security', label: 'Security' },
  { id: 'danger', label: 'Danger Zone', danger: true },
]

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  weeklyAiDigest: true,
  recommendationAlerts: true,
  goalAchievements: true,
  securityAlerts: true,
  newDiscoveries: true,
  priorityAlerts: true,
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  theme: 'dark',
  reducedMotion: false,
  notifications: DEFAULT_NOTIFICATIONS,
  bubbleEnabled: true,
  bubblePosition: 'bottom-right',
  assistantMode: 'balanced',
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  responseStyle: 'CONCISE',
  autoSuggestions: true,
  jarvisVoiceGender: 'feminine',
  jarvisLanguage: 'en',
}

export function settingsStorageKey(storeId: string | null): string {
  return `${SETTINGS_STORAGE_PREFIX}${storeId ?? 'local'}`
}

export function defaultWorkspaceSettings(lightMode = false): WorkspaceSettings {
  return { ...DEFAULT_WORKSPACE_SETTINGS, theme: lightMode ? 'light' : 'dark', notifications: { ...DEFAULT_NOTIFICATIONS } }
}

export function isSettingsTab(value: unknown): value is SettingsTab {
  return value === 'general' || value === 'notifications' || value === 'ai' || value === 'team' || value === 'security' || value === 'danger'
}

export function isEmailValid(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim())
}

export function verificationBadge(state: EmailVerificationState): Readonly<{ label: string; tone: 'green' | 'amber' | 'neutral' }> {
  if (state === 'verified') return { label: 'Verified', tone: 'green' }
  if (state === 'pending') return { label: 'Pending verification', tone: 'amber' }
  if (state === 'required') return { label: 'Verification required', tone: 'amber' }
  return { label: 'Not configured', tone: 'neutral' }
}

export function emailVerificationState(input: Readonly<{ email: string; verified: boolean; pending: boolean }>): EmailVerificationState {
  if (!input.email.trim()) return 'unconfigured'
  if (input.verified) return 'verified'
  if (input.pending) return 'pending'
  return 'required'
}

export function planFromBilling(account: BillingAccount | null): WorkspacePlan {
  const raw = account?.subscription?.plan
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase()
    if (normalized === 'commander' || normalized === 'growth' || normalized === 'start') return normalized
  }
  return 'trial'
}

export function teamInviteAllowed(plan: WorkspacePlan): boolean {
  return plan === 'growth' || plan === 'commander'
}

export function shopifyAdminUrl(shop: string | null): string | null {
  if (!shop) return null
  const host = shop.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!host || !host.includes('.')) return null
  return `https://${host}/admin`
}

export function shopifyAppsUrl(shop: string | null): string | null {
  const admin = shopifyAdminUrl(shop)
  return admin ? `${admin}/settings/apps` : null
}

export function engagementFromAssistantMode(mode: AssistantMode): JarvisEngagementMode {
  if (mode === 'active') return 'proactive'
  if (mode === 'quiet') return 'quiet'
  return 'balanced'
}

export function assistantModeFromEngagement(mode: JarvisEngagementMode | null | undefined): AssistantMode {
  if (mode === 'proactive') return 'active'
  if (mode === 'quiet' || mode === 'answer-only') return 'quiet'
  return 'balanced'
}

export function personalityLabel(value: CoachPersonality | string | null | undefined): string {
  if (value === 'MOTIVATIONAL') return 'Motivational'
  if (value === 'ANALYTICAL') return 'Analytical'
  if (value === 'CASUAL') return 'Friendly'
  return 'Professional'
}

export function mergeWorkspaceSettings(base: WorkspaceSettings, patch: Partial<WorkspaceSettings>): WorkspaceSettings {
  return {
    ...base,
    ...patch,
    notifications: patch.notifications ? { ...base.notifications, ...patch.notifications } : base.notifications,
  }
}

export function parseWorkspaceSettings(value: unknown, fallback: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS): WorkspaceSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback
  const record = value as Record<string, unknown>
  const notifications = isRecord(record.notifications) ? record.notifications : {}
  return {
    theme: record.theme === 'light' ? 'light' : 'dark',
    reducedMotion: record.reducedMotion === true,
    notifications: {
      weeklyAiDigest: notifications.weeklyAiDigest !== false,
      recommendationAlerts: notifications.recommendationAlerts !== false,
      goalAchievements: notifications.goalAchievements !== false,
      securityAlerts: notifications.securityAlerts !== false,
      newDiscoveries: notifications.newDiscoveries !== false,
      priorityAlerts: notifications.priorityAlerts !== false,
    },
    bubbleEnabled: record.bubbleEnabled !== false,
    bubblePosition: record.bubblePosition === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    assistantMode: record.assistantMode === 'active' || record.assistantMode === 'quiet' ? record.assistantMode : 'balanced',
    quietHoursEnabled: record.quietHoursEnabled === true,
    quietHoursStart: isTime(record.quietHoursStart) ? record.quietHoursStart : fallback.quietHoursStart,
    quietHoursEnd: isTime(record.quietHoursEnd) ? record.quietHoursEnd : fallback.quietHoursEnd,
    responseStyle: record.responseStyle === 'DETAILED' || record.responseStyle === 'TECHNICAL' ? record.responseStyle : 'CONCISE',
    autoSuggestions: record.autoSuggestions !== false,
    jarvisVoiceGender: record.jarvisVoiceGender === 'masculine' || record.jarvisVoiceGender === 'male' ? 'masculine' : 'feminine',
    jarvisLanguage: record.jarvisLanguage === 'hi' || record.jarvisLanguage === 'hindi' ? 'hi' : 'en',
  }
}

export function readWorkspaceSettings(storeId: string | null, fallback?: WorkspaceSettings): WorkspaceSettings {
  const base = fallback ?? DEFAULT_WORKSPACE_SETTINGS
  try {
    const raw = window.localStorage.getItem(settingsStorageKey(storeId))
    if (!raw) return base
    return parseWorkspaceSettings(JSON.parse(raw), base)
  } catch {
    return base
  }
}

export function writeWorkspaceSettings(storeId: string | null, settings: WorkspaceSettings): void {
  try {
    window.localStorage.setItem(settingsStorageKey(storeId), JSON.stringify(settings))
  } catch {
    /* embedded browsers may disable storage */
  }
  try {
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }))
  } catch {
    /* jsdom / embedded browsers may restrict CustomEvent */
  }
}

export function clearWorkspaceAiData(storeId: string | null): readonly string[] {
  const cleared: string[] = []
  if (typeof window === 'undefined') return cleared
  const prefixes = storeId
    ? [
      `profitpilot:jarvis:dismissed:${storeId}`,
      `profitpilot:jarvis:snoozed:${storeId}`,
      `profitpilot:notifications:read:${storeId}`,
      settingsStorageKey(storeId),
    ]
    : []
  for (const key of prefixes) {
    try {
      if (window.localStorage.getItem(key) !== null) {
        window.localStorage.removeItem(key)
        cleared.push(key)
      }
    } catch {
      /* storage may be disabled */
    }
  }
  return cleared
}

export function confirmationMatchesStore(typed: string, shop: string | null): boolean {
  const expected = (shop ?? '').trim().toLowerCase()
  if (!expected) return false
  return typed.trim().toLowerCase() === expected
}

export function quietHoursSilenceUntil(settings: WorkspaceSettings, now = Date.now()): number | null {
  if (!settings.quietHoursEnabled) return null
  const start = minutesFromClock(settings.quietHoursStart)
  const end = minutesFromClock(settings.quietHoursEnd)
  if (start === null || end === null) return null
  const date = new Date(now)
  const current = date.getHours() * 60 + date.getMinutes()
  const inWindow = start === end ? true : start < end ? current >= start && current < end : current >= start || current < end
  if (!inWindow) return null
  const endDate = new Date(now)
  endDate.setHours(Math.floor(end / 60), end % 60, 0, 0)
  if (endDate.getTime() <= now) endDate.setDate(endDate.getDate() + 1)
  return endDate.getTime()
}

export function formatSecurityDate(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp))
}

export function ownerDisplayName(shop: string | null): string {
  if (!shop) return 'Store owner'
  const handle = shop.trim().toLowerCase().replace(/\.myshopify\.com$/, '')
  if (handle === 'commander-pilot' || handle === 'commander_pilot') return 'Commander Pilot'
  const words = handle.split(/[-_]+/).filter(Boolean).slice(0, 3)
  if (words.length === 0) return 'Store owner'
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)
}

function minutesFromClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}
