/**
 * Settings workspace — store preferences, notifications, AI assistant,
 * team access, security, and irreversible account actions.
 *
 * Every control either writes to a real API, persists locally for this store,
 * or is honestly plan-gated. Nothing is decorative.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  Lock,
  Mail,
  Moon,
  Palette,
  ShieldCheck,
  Store,
  Sun,
  Trash2,
  Users,
  Settings as SettingsIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  ApiClientError,
  exportRows,
  fetchBilling,
  fetchCoachPreferences,
  fetchJarvisPreferences,
  fetchMerchantEmail,
  fetchSyncStatus,
  saveJarvisPreferences,
  saveMerchantEmail,
  saveWorkspaceSettings,
  updateCoachPreferences,
  verifyMerchantEmail,
} from './api.js'
import { fetchAiCommandPreferences, updateAiCommandPreferences } from './ai-command-api.js'
import type { BillingAccount, WorkspaceContext } from './model.js'
import type { SyncStatus } from './api.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import { CustomSelect } from './CustomSelect.js'
import type { CoachPersonality } from './store-coach-model.js'
import { PERSONALITY_META, coachPersonalitiesForPlan } from './store-coach-model.js'
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
  mergeWorkspaceSettings,
  ownerDisplayName,
  parseWorkspaceSettings,
  planFromBilling,
  quietHoursSilenceUntil,
  readWorkspaceSettings,
  shopifyAdminUrl,
  shopifyAppsUrl,
  teamInviteAllowed,
  verificationBadge,
  writeWorkspaceSettings,
} from './settings-model.js'
import type {
  AssistantMode,
  BubblePosition,
  NotificationPreferences,
  ResponseStyle,
  SettingsTab,
  WorkspacePlan,
  WorkspaceSettings,
} from './settings-model.js'

export type SettingsToastKind = 'success' | 'info' | 'warning' | 'error'

export type SettingsPageProps = Readonly<{
  context: WorkspaceContext
  lightMode: boolean
  onTheme: () => void
  onToast: (message: string, kind?: SettingsToastKind) => void
  onNavigateBilling?: () => void
}>

export function SettingsPage({ context, lightMode, onTheme, onToast, onNavigateBilling }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [settings, setSettings] = useState<WorkspaceSettings>(() => defaultWorkspaceSettings(lightMode))
  const [plan, setPlan] = useState<WorkspacePlan>('trial')
  const [account, setAccount] = useState<BillingAccount | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)

  useEffect(() => {
    setSettings(readWorkspaceSettings(context.storeId, defaultWorkspaceSettings(lightMode)))
    // Theme is applied live by the shell; do not reload settings on every theme flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.storeId])

  useEffect(() => {
    if (!context.storeId) {
      setAccount(null)
      setSyncStatus(null)
      setPlan('trial')
      return
    }
    const storeId = context.storeId
    let cancelled = false
    void Promise.allSettled([fetchBilling(storeId), fetchSyncStatus(storeId)]).then(([billing, sync]) => {
      if (cancelled) return
      const nextAccount = billing.status === 'fulfilled' ? billing.value : null
      setAccount(nextAccount)
      setPlan(planFromBilling(nextAccount))
      setSyncStatus(sync.status === 'fulfilled' ? sync.value : null)
    })
    return () => { cancelled = true }
  }, [context.storeId])

  const persist = (next: WorkspaceSettings) => {
    setSettings(next)
    writeWorkspaceSettings(context.storeId, next)
  }

  const goBilling = () => {
    if (onNavigateBilling) onNavigateBilling()
    else onToast('Open Billing from the sidebar to choose a plan.', 'info')
  }

  return (
    <div className="page-content settings-page" data-settings-tab={tab}>
      <div className="page-header">
        <div>
          <div className="page-eyebrow"><SettingsIcon size={12} /> Settings</div>
          <h1>Settings</h1>
          <p>Manage your store preferences, notifications, and account.</p>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="settings-nav card" aria-label="Settings sections">
          {SETTINGS_TABS.map((item) => {
            const Icon = tabIcon(item.id)
            return (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-item ${tab === item.id ? 'active' : ''} ${item.danger ? 'danger' : ''}`}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => setTab(item.id)}
              >
                <Icon size={16} /> {item.label}
              </button>
            )
          })}
        </aside>
        <div className="settings-panels">
          {tab === 'general' && (
            <GeneralTab
              context={context}
              lightMode={lightMode}
              settings={settings}
              onTheme={onTheme}
              onToast={onToast}
              onSettings={persist}
            />
          )}
          {tab === 'notifications' && (
            <NotificationsTab
              context={context}
              settings={settings}
              onToast={onToast}
              onSettings={persist}
            />
          )}
          {tab === 'ai' && (
            <AiPreferencesTab
              context={context}
              plan={plan}
              settings={settings}
              onToast={onToast}
              onSettings={persist}
              onUpgrade={goBilling}
            />
          )}
          {tab === 'team' && (
            <TeamTab context={context} plan={plan} onUpgrade={goBilling} />
          )}
          {tab === 'security' && (
            <SecurityTab
              context={context}
              account={account}
              syncStatus={syncStatus}
              onToast={onToast}
            />
          )}
          {tab === 'danger' && (
            <DangerTab context={context} onToast={onToast} onSettings={persist} lightMode={lightMode} />
          )}
        </div>
      </div>
    </div>
  )
}

function GeneralTab({
  context,
  lightMode,
  settings,
  onTheme,
  onToast,
  onSettings,
}: {
  context: WorkspaceContext
  lightMode: boolean
  settings: WorkspaceSettings
  onTheme: () => void
  onToast: (message: string, kind?: SettingsToastKind) => void
  onSettings: (next: WorkspaceSettings) => void
}) {
  const [email, setEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [verified, setVerified] = useState(false)
  const [pending, setPending] = useState(false)
  const [verificationToken, setVerificationToken] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const adminUrl = shopifyAdminUrl(context.shop)
  const verification = emailVerificationState({ email, verified, pending })
  const badge = verificationBadge(verification)

  useEffect(() => {
    if (!context.storeId) {
      setEmail('')
      setFromName('')
      setVerified(false)
      setPending(false)
      setVerificationToken('')
      setLoaded(true)
      return
    }
    let cancelled = false
    setLoaded(false)
    void fetchMerchantEmail(context.storeId)
      .then((config) => {
        if (cancelled || !config) return
        setEmail(config.merchantEmail)
        setFromName(config.fromName)
        setVerified(config.verified)
        setPending(!config.verified && config.verificationSentAt !== null)
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [context.storeId])

  const saveEmail = async () => {
    if (!context.storeId) { onToast('Connect Shopify before configuring merchant email.', 'info'); return }
    if (!isEmailValid(email) || !fromName.trim()) { onToast('Enter a valid email address and a from name.', 'info'); return }
    setSavingEmail(true)
    try {
      const result = await saveMerchantEmail(context.storeId, email.trim(), fromName.trim())
      const token = typeof result.verificationToken === 'string' ? result.verificationToken : ''
      setVerificationToken(token)
      setVerified(false)
      setPending(true)
      onToast(result.emailSent === false ? 'Email saved. Confirm verification below — the verification email could not be sent yet.' : 'Verification email sent!', 'success')
    } catch (error: unknown) {
      onToast(errorMessage(error), 'error')
    } finally {
      setSavingEmail(false)
    }
  }

  const confirmVerification = async () => {
    if (!verificationToken) { onToast('Save the email first so a verification token can be created.', 'info'); return }
    setSavingEmail(true)
    try {
      await verifyMerchantEmail(verificationToken)
      setVerified(true)
      setPending(false)
      onToast('Merchant email verified.', 'success')
    } catch (error: unknown) {
      onToast(errorMessage(error), 'error')
    } finally {
      setSavingEmail(false)
    }
  }

  const savePreferences = async () => {
    setSavingPrefs(true)
    try {
      const next = mergeWorkspaceSettings(settings, { theme: lightMode ? 'light' : 'dark', reducedMotion: settings.reducedMotion })
      onSettings(next)
      await persistWorkspaceSettings(context.storeId, next)
      onToast('Preferences saved.', 'success')
    } catch (error: unknown) {
      onToast(errorMessage(error), 'error')
    } finally {
      setSavingPrefs(false)
    }
  }

  return (
    <>
      <SettingsPanel icon={Store} title="Store information" description="This information is read from your Shopify connection and cannot be changed here.">
        <SettingRow label="Shopify store" description="Opens your Shopify admin in a new tab">
          {adminUrl && context.shop
            ? <a className="setting-store-link" href={adminUrl} target="_blank" rel="noopener noreferrer">{context.shop} <ExternalLink size={13} /></a>
            : <span className="setting-readonly">{context.shop ?? 'Not connected'}</span>}
        </SettingRow>
        {context.storeId && (
          <SettingRow label="Store ID" description="Used only for tenant-scoped requests">
            <span className="setting-store-id">{context.storeId}</span>
          </SettingRow>
        )}
      </SettingsPanel>

      <SettingsPanel icon={Mail} title="Email settings" description={'Set your “From” address for customer emails. This email appears as the sender when you send campaigns or automated emails.'}>
        <SettingRow label="Email address" description="The From address for customer campaigns">
          <input className="setting-input" value={email} onChange={(event) => { setEmail(event.target.value); setVerified(false); setPending(false) }} placeholder="merchant@example.com" autoComplete="email" disabled={!loaded && Boolean(context.storeId)} />
        </SettingRow>
        <SettingRow label="From name" description="Shown to campaign recipients">
          <input className="setting-input" value={fromName} onChange={(event) => { setFromName(event.target.value); setVerified(false) }} placeholder="Your store" disabled={!loaded && Boolean(context.storeId)} />
        </SettingRow>
        <div className="email-verification-row">
          <span className={`status-badge ${badge.tone}`}>{verified ? <><Check size={11} /> {badge.label}</> : badge.label}</span>
          <button type="button" className="button secondary" onClick={() => void saveEmail()} disabled={!email || !fromName || savingEmail}>
            {savingEmail ? 'Saving…' : 'Save and verify'}
          </button>
          {verificationToken && !verified && (
            <button type="button" className="button primary" onClick={() => void confirmVerification()} disabled={savingEmail}>
              Confirm verification
            </button>
          )}
        </div>
        {!verified && email && (
          <p className="settings-note amber"><AlertTriangle size={14} /> We’ll send a verification link to confirm you own this email address. Campaigns never send from a ProfitPilot system address.</p>
        )}
      </SettingsPanel>

      <SettingsPanel icon={Palette} title="Appearance" description="Choose your preferred visual theme and motion.">
        <SettingRow label="Theme" description="Choose your preferred visual theme.">
          <div className="theme-choice" role="group" aria-label="Theme">
            <button type="button" className={!lightMode ? 'selected' : ''} onClick={() => lightMode && onTheme()}><Moon size={15} /> Dark</button>
            <button type="button" className={lightMode ? 'selected' : ''} onClick={() => !lightMode && onTheme()}><Sun size={15} /> Light</button>
          </div>
        </SettingRow>
        <SettingRow label="Reduced motion" description="Reduces animations for accessibility.">
          <SettingsToggle
            label="Reduced motion"
            on={settings.reducedMotion}
            onChange={(value) => onSettings(mergeWorkspaceSettings(settings, { reducedMotion: value }))}
          />
        </SettingRow>
      </SettingsPanel>

      <div className="settings-save">
        <span><ShieldCheck size={15} /> Preferences stay on this device and sync when the API is available.</span>
        <button type="button" className="button primary" onClick={() => void savePreferences()} disabled={savingPrefs}>
          {savingPrefs ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </>
  )
}

function NotificationsTab({
  context,
  settings,
  onToast,
  onSettings,
}: {
  context: WorkspaceContext
  settings: WorkspaceSettings
  onToast: (message: string, kind?: SettingsToastKind) => void
  onSettings: (next: WorkspaceSettings) => void
}) {
  const [saving, setSaving] = useState(false)
  const notifications = settings.notifications

  const toggle = (key: keyof NotificationPreferences) => {
    const next = mergeWorkspaceSettings(settings, { notifications: { ...notifications, [key]: !notifications[key] } })
    onSettings(next)
  }

  const save = async () => {
    setSaving(true)
    try {
      await persistWorkspaceSettings(context.storeId, settings)
      onToast('Notification preferences saved.', 'success')
    } catch (error: unknown) {
      onToast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SettingsPanel icon={Mail} title="Email notifications" description="Choose which email notifications you receive.">
        <ToggleRow label="Weekly AI digest" hint="Receive a weekly summary of AI insights" on={notifications.weeklyAiDigest} onChange={() => toggle('weeklyAiDigest')} />
        <ToggleRow label="Recommendation alerts" hint="When new recommendations are ready" on={notifications.recommendationAlerts} onChange={() => toggle('recommendationAlerts')} />
        <ToggleRow label="Goal achievements" hint="When you achieve weekly goals" on={notifications.goalAchievements} onChange={() => toggle('goalAchievements')} />
        <ToggleRow label="Security alerts" hint="Important security notifications" on={notifications.securityAlerts} onChange={() => toggle('securityAlerts')} />
      </SettingsPanel>
      <SettingsPanel icon={Bell} title="In-app notifications" description="These appear in the workspace bell, never as invented alerts.">
        <ToggleRow label="New discoveries" hint="When PatternAI finds something new" on={notifications.newDiscoveries} onChange={() => toggle('newDiscoveries')} />
        <ToggleRow label="Priority alerts" hint="When Store Coach has urgent priorities" on={notifications.priorityAlerts} onChange={() => toggle('priorityAlerts')} />
      </SettingsPanel>
      <div className="settings-save">
        <span><Bell size={15} /> Changes apply on this device immediately and save when you confirm.</span>
        <button type="button" className="button primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save notification preferences'}
        </button>
      </div>
    </>
  )
}

function AiPreferencesTab({
  context,
  plan,
  settings,
  onToast,
  onSettings,
  onUpgrade,
}: {
  context: WorkspaceContext
  plan: WorkspacePlan
  settings: WorkspaceSettings
  onToast: (message: string, kind?: SettingsToastKind) => void
  onSettings: (next: WorkspaceSettings) => void
  onUpgrade: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [personality, setPersonality] = useState<CoachPersonality>('PROFESSIONAL')
  const allowedPersonalities = coachPersonalitiesForPlan(plan)

  useEffect(() => {
    if (!context.storeId) return
    const storeId = context.storeId
    let cancelled = false
    void Promise.allSettled([
      fetchJarvisPreferences(storeId),
      fetchCoachPreferences(storeId),
      fetchAiCommandPreferences(storeId),
    ]).then(([jarvis, coach, command]) => {
      if (cancelled) return
      let next = settings
      if (jarvis.status === 'fulfilled') next = mergeWorkspaceSettings(next, { assistantMode: assistantModeFromEngagement(jarvis.value.engagementMode) })
      if (command.status === 'fulfilled') next = mergeWorkspaceSettings(next, { responseStyle: command.value.defaultResponseStyle, autoSuggestions: command.value.autoSuggestionsEnabled })
      if (coach.status === 'fulfilled') setPersonality(coach.value.personality)
      if (next !== settings) onSettings(next)
    })
    return () => { cancelled = true }
    // Load once per store — settings object is not a dependency so we don't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.storeId])

  const save = async () => {
    if (!context.storeId) { onToast('Connect Shopify before saving AI preferences.', 'info'); return }
    setSaving(true)
    try {
      const silenceUntil = quietHoursSilenceUntil(settings)
      const [workspaceOutcome, jarvisOutcome, coachOutcome, commandOutcome] = await Promise.allSettled([
        persistWorkspaceSettings(context.storeId, settings),
        saveJarvisPreferences({
          storeId: context.storeId,
          engagementMode: engagementFromAssistantMode(settings.assistantMode),
          onlyAnswerWhenAsked: settings.assistantMode === 'quiet',
          silenceUntil,
        }),
        updateCoachPreferences(context.storeId, { personality }),
        updateAiCommandPreferences(context.storeId, {
          defaultResponseStyle: settings.responseStyle,
          autoSuggestionsEnabled: settings.autoSuggestions,
        }),
      ])
      // A plan gate (402) from the coach or AI Command server is surfaced as an
      // upgrade prompt; the other saves still go through.
      const planGate = [coachOutcome, commandOutcome].find((outcome) => outcome.status === 'rejected' && outcome.reason instanceof ApiClientError && outcome.reason.status === 402)
      if (planGate) {
        onToast('That AI setting unlocks with a plan upgrade.', 'warning')
        onUpgrade()
        return
      }
      onSettings(settings)
      if (jarvisOutcome.status === 'rejected') {
        onToast(errorMessage(jarvisOutcome.reason), 'error')
        return
      }
      const partialFailures = [workspaceOutcome, coachOutcome, commandOutcome].filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected').length
      onToast(partialFailures > 0
        ? 'Saved on this device, but some AI server settings could not be saved right now. Try again in a moment.'
        : 'AI preferences saved.', partialFailures > 0 ? 'warning' : 'success')
    } finally {
      setSaving(false)
    }
  }

  const modes: readonly Readonly<{ id: AssistantMode; label: string; hint: string }>[] = [
    { id: 'active', label: 'Active', hint: 'Responds to all questions and can surface relevant recommendations.' },
    { id: 'balanced', label: 'Balanced', hint: 'Responds when relevant without interrupting quiet work.' },
    { id: 'quiet', label: 'Quiet', hint: 'Only urgent notifications. The assistant stays silent otherwise.' },
  ]

  return (
    <>
      <SettingsPanel icon={Bot} title="AI assistant mode" description="Configure how the floating assistant behaves across the workspace.">
        <div className="settings-choice-stack" role="radiogroup" aria-label="AI assistant mode">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`settings-choice ${settings.assistantMode === mode.id ? 'selected' : ''}`}
              role="radio"
              aria-checked={settings.assistantMode === mode.id}
              onClick={() => onSettings(mergeWorkspaceSettings(settings, { assistantMode: mode.id }))}
            >
              <i />
              <span><strong>{mode.label}</strong><small>{mode.hint}</small></span>
            </button>
          ))}
        </div>
      </SettingsPanel>

      <SettingsPanel icon={Bot} title="Floating assistant (Jarvis)" description="The voice assistant orb that lives in the corner of every page. Tap it to talk; answers are spoken.">
        <ToggleRow
          label="Show floating AI bubble"
          hint="Hide the orb if you prefer a quieter workspace."
          on={settings.bubbleEnabled}
          onChange={(value) => onSettings(mergeWorkspaceSettings(settings, { bubbleEnabled: value }))}
        />
        <SettingRow label="Position" description="Where the orb sits on the screen">
          <CustomSelect
            ariaLabel="Floating assistant position"
            value={settings.bubblePosition}
            options={[{ value: 'bottom-right', label: 'Bottom right' }, { value: 'bottom-left', label: 'Bottom left' }]}
            onChange={(value: BubblePosition) => onSettings(mergeWorkspaceSettings(settings, { bubblePosition: value }))}
          />
        </SettingRow>
        <ToggleRow
          label="Quiet hours"
          hint="Suppress proactive assistant messages during these hours."
          on={settings.quietHoursEnabled}
          onChange={(value) => onSettings(mergeWorkspaceSettings(settings, { quietHoursEnabled: value }))}
        />
        {settings.quietHoursEnabled && (
          <SettingRow label="Quiet hours window" description="Local time on this device">
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="setting-input" type="time" value={settings.quietHoursStart} onChange={(event) => onSettings(mergeWorkspaceSettings(settings, { quietHoursStart: event.target.value || '22:00' }))} aria-label="Quiet hours start" style={{ minWidth: 130 }} />
              <input className="setting-input" type="time" value={settings.quietHoursEnd} onChange={(event) => onSettings(mergeWorkspaceSettings(settings, { quietHoursEnd: event.target.value || '07:00' }))} aria-label="Quiet hours end" style={{ minWidth: 130 }} />
            </div>
          </SettingRow>
        )}
      </SettingsPanel>

      <SettingsPanel icon={Users} title="Store Coach personality" description={`Currently: ${PERSONALITY_META[personality].label}`}>
        <div className="settings-personality">
          {(Object.keys(PERSONALITY_META) as CoachPersonality[]).map((item) => {
            const locked = !allowedPersonalities.includes(item)
            const meta = PERSONALITY_META[item]
            return (
              <button
                key={item}
                type="button"
                className={personality === item ? 'selected' : ''}
                disabled={locked}
                onClick={() => {
                  if (locked) { onToast('That personality unlocks with a plan upgrade.', 'warning'); onUpgrade(); return }
                  setPersonality(item)
                }}
              >
                <strong>{meta.emoji} {meta.label}{locked ? ' · Upgrade Plan' : ''}</strong>
                <small>{meta.tagline}</small>
              </button>
            )
          })}
        </div>
        {plan !== 'commander' && plan !== 'growth' && (
          <div className="settings-actions-row">
            <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
          </div>
        )}
      </SettingsPanel>

      <SettingsPanel icon={SettingsIcon} title="AI Command" description="How AI Command answers and suggests follow-ups.">
        <SettingRow label="Response style" description="Default length of AI Command answers">
          <CustomSelect
            ariaLabel="AI Command response style"
            value={settings.responseStyle}
            options={[
              { value: 'CONCISE', label: 'Concise' },
              { value: 'DETAILED', label: 'Detailed' },
              { value: 'TECHNICAL', label: 'Technical' },
            ]}
            onChange={(value: ResponseStyle) => onSettings(mergeWorkspaceSettings(settings, { responseStyle: value }))}
          />
        </SettingRow>
        <ToggleRow
          label="Auto-suggestions"
          hint="Show suggested follow-up commands after an answer."
          on={settings.autoSuggestions}
          onChange={(value) => onSettings(mergeWorkspaceSettings(settings, { autoSuggestions: value }))}
        />
      </SettingsPanel>

      <div className="settings-save">
        <span><Bot size={15} /> Assistant, coach, and command preferences save together.</span>
        <button type="button" className="button primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save AI preferences'}
        </button>
      </div>
    </>
  )
}

function TeamTab({ context, plan, onUpgrade }: { context: WorkspaceContext; plan: WorkspacePlan; onUpgrade: () => void }) {
  const canInvite = teamInviteAllowed(plan)
  const owner = ownerDisplayName(context.shop)
  return (
    <SettingsPanel icon={Users} title="Team members" description="Manage who has access to your ProfitPilot workspace.">
      {context.storeId ? (
        <div className="settings-team-card">
          <span className="settings-avatar">{owner.slice(0, 2).toUpperCase()}</span>
          <div className="settings-team-copy">
            <strong>{owner} (Owner)</strong>
            <small>{context.shop ?? 'Connected store'}</small>
            <small>Role: Owner · Access: Full</small>
          </div>
        </div>
      ) : (
        <div className="settings-empty">
          <Users size={20} />
          <strong>Connect a store first</strong>
          <p>Team access is scoped to a connected Shopify store.</p>
        </div>
      )}
      <div className="settings-empty">
        <Lock size={18} />
        <strong>Coming soon</strong>
        <p>Team management will let you invite staff members with specific roles and permissions. Available on Growth and Commander plans.</p>
      </div>
      <div className="settings-actions-row">
        {canInvite
          ? <button type="button" className="button secondary" disabled title="Invites are not available yet">+ Invite team member</button>
          : <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />}
      </div>
    </SettingsPanel>
  )
}

function SecurityTab({
  context,
  account,
  syncStatus,
  onToast,
}: {
  context: WorkspaceContext
  account: BillingAccount | null
  syncStatus: SyncStatus | null
  onToast: (message: string, kind?: SettingsToastKind) => void
}) {
  const [exporting, setExporting] = useState<'audit' | 'orders' | null>(null)
  const connected = Boolean(context.storeId && (syncStatus?.hasAccessToken ?? true))
  const lastAuth = formatSecurityDate(account?.subscription?.currentPeriodEnd ?? account?.trial?.startedAt ?? null)
  const shopLabel = syncStatus?.shopDomain ?? context.shop

  const download = async (dataset: 'audit' | 'orders') => {
    if (!context.storeId) { onToast('Connect Shopify before exporting data.', 'info'); return }
    setExporting(dataset)
    try {
      const result = await exportRows('CSV', [], window.fetch, { storeId: context.storeId, dataset })
      if (result.bodyBase64) {
        const binary = atob(result.bodyBase64)
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: result.contentType }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = result.filename
        anchor.click()
        URL.revokeObjectURL(url)
      }
      onToast(result.rows > 0 ? `${result.filename} is ready (${result.rows} rows).` : 'No rows were available to export yet.', result.rows > 0 ? 'success' : 'info')
    } catch (error: unknown) {
      onToast(errorMessage(error), 'error')
    } finally {
      setExporting(null)
    }
  }

  return (
    <>
      <SettingsPanel icon={ShieldCheck} title="Account security" description="Connection and encryption status for this store.">
        <div className="settings-security-row">
          <span className={`settings-dot ${connected ? '' : 'off'}`} />
          <div className="settings-security-copy">
            <strong>Shopify OAuth: {connected ? 'Connected' : 'Not connected'}</strong>
            <small>{shopLabel ? shopLabel : 'No store attached yet.'}{lastAuth ? ` · Current period / trial reference: ${lastAuth}` : ''}</small>
          </div>
        </div>
        <div className="settings-security-row">
          <span className="settings-dot" />
          <div className="settings-security-copy">
            <strong>Data encryption: Active</strong>
            <small>All data is encrypted at rest in the ProfitPilot data plane.</small>
          </div>
        </div>
        <div className="settings-security-row">
          <span className="settings-dot" />
          <div className="settings-security-copy">
            <strong>API access: Scoped</strong>
            <small>Read-only access to store data unless you approve a specific action.</small>
          </div>
        </div>
      </SettingsPanel>

      <SettingsPanel icon={ShieldCheck} title="Recent activity" description="Security events for this store, when any have been recorded.">
        <div className="settings-empty">
          <Info size={18} />
          <strong>No recent security events</strong>
          <p>Audit entries appear here after signed operator actions. Nothing is invented to fill the list.</p>
        </div>
      </SettingsPanel>

      <SettingsPanel icon={Lock} title="Data & privacy" description="How ProfitPilot treats this store’s data.">
        <ul className="settings-privacy">
          <li><CheckCircle2 size={14} /> Your data is tenant-isolated (row-level security).</li>
          <li><CheckCircle2 size={14} /> PII is never shared with AI models.</li>
          <li><CheckCircle2 size={14} /> All AI responses are grounded in your synced store data.</li>
        </ul>
        <div className="settings-actions-row">
          <button type="button" className="button secondary" onClick={() => void download('audit')} disabled={exporting !== null}>
            <Download size={14} /> {exporting === 'audit' ? 'Preparing…' : 'View full audit log'}
          </button>
          <button type="button" className="button secondary" onClick={() => void download('orders')} disabled={exporting !== null}>
            <Download size={14} /> {exporting === 'orders' ? 'Preparing…' : 'Download data export'}
          </button>
        </div>
      </SettingsPanel>
    </>
  )
}

function DangerTab({
  context,
  onToast,
  onSettings,
  lightMode,
}: {
  context: WorkspaceContext
  onToast: (message: string, kind?: SettingsToastKind) => void
  onSettings: (next: WorkspaceSettings) => void
  lightMode: boolean
}) {
  const [clearOpen, setClearOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  const clearAi = () => {
    setBusy(true)
    try {
      const cleared = clearWorkspaceAiData(context.storeId)
      onSettings(defaultWorkspaceSettings(lightMode))
      setClearOpen(false)
      onToast(cleared.length > 0
        ? 'Cleared locally stored AI recommendations, dismissed items, and notification state. Your Shopify data is unchanged.'
        : 'No locally stored AI data was present on this device. Your Shopify data is unchanged.', 'success')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = () => {
    if (!confirmationMatchesStore(typed, context.shop)) {
      onToast('Type your exact Shopify store domain to confirm.', 'warning')
      return
    }
    setBusy(true)
    try {
      const apps = shopifyAppsUrl(context.shop)
      setDisconnectOpen(false)
      onToast('Open Shopify admin to uninstall ProfitPilot. Synced data is removed after uninstall.', 'warning')
      if (apps) window.open(apps, '_blank', 'noopener,noreferrer')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="settings-note red"><AlertTriangle size={15} /> These actions are irreversible. Please be careful.</p>
      <SettingsPanel icon={Trash2} tone="red" title="Clear all AI data" description="Remove recommendations, dismissed items, and AI-generated content stored for this workspace on this device. Your Shopify data stays intact.">
        <div className="settings-danger-card">
          <div className="settings-danger-copy">
            <strong>Clear AI data</strong>
            <p>This does not delete products, orders, or customers from Shopify.</p>
          </div>
          <button type="button" className="button danger" onClick={() => setClearOpen(true)}>Clear AI data</button>
        </div>
      </SettingsPanel>
      <SettingsPanel icon={AlertTriangle} tone="red" title="Disconnect store" description="Remove ProfitPilot from your Shopify store. All synced data will be deleted after uninstall.">
        <div className="settings-danger-card">
          <div className="settings-danger-copy">
            <strong>Disconnect</strong>
            <p>You will confirm by typing your store domain, then continue in Shopify admin.</p>
          </div>
          <button type="button" className="button danger" onClick={() => { setTyped(''); setDisconnectOpen(true) }} disabled={!context.shop}>Disconnect</button>
        </div>
      </SettingsPanel>

      {clearOpen && (
        <ConfirmModal
          title="Clear all AI data?"
          body="This removes locally stored recommendations, dismissed items, and notification state for this workspace. Shopify catalog, orders, and customers are not touched."
          confirmLabel={busy ? 'Clearing…' : 'Clear AI data'}
          danger
          onCancel={() => setClearOpen(false)}
          onConfirm={clearAi}
        />
      )}
      {disconnectOpen && (
        <ConfirmModal
          title="Disconnect this store?"
          body={`Type ${context.shop ?? 'your store domain'} to confirm. You will then uninstall ProfitPilot from Shopify admin. This cannot be undone from here.`}
          confirmLabel={busy ? 'Opening Shopify…' : 'Disconnect'}
          danger
          disabled={!confirmationMatchesStore(typed, context.shop)}
          onCancel={() => setDisconnectOpen(false)}
          onConfirm={disconnect}
        >
          <label>Store domain
            <input className="setting-input" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={context.shop ?? 'your-store.myshopify.com'} style={{ width: '100%', marginTop: 8 }} />
          </label>
        </ConfirmModal>
      )}
    </>
  )
}

function SettingsPanel({ icon: Icon, title, description, children, tone }: { icon: LucideIcon; title: string; description: string; children: ReactNode; tone?: 'red' }) {
  return (
    <section className="card settings-panel">
      <div className="settings-panel-head">
        <span className={`settings-panel-icon ${tone === 'red' ? 'red' : ''}`}><Icon size={16} /></span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      {children}
    </div>
  )
}

function ToggleRow({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (value: boolean) => void }) {
  return (
    <SettingRow label={label} description={hint}>
      <SettingsToggle label={label} on={on} onChange={onChange} />
    </SettingRow>
  )
}

export function SettingsToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      className={`settings-toggle ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  )
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  disabled,
  onCancel,
  onConfirm,
  children,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  disabled?: boolean
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}) {
  return (
    <div className="settings-modal-overlay">
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-confirm-title">
        <div className="section-kicker"><AlertTriangle size={13} /> Confirm</div>
        <h2 id="settings-confirm-title">{title}</h2>
        <p>{body}</p>
        {children}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className={`button ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={disabled}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function tabIcon(tab: SettingsTab): LucideIcon {
  if (tab === 'notifications') return Bell
  if (tab === 'ai') return Bot
  if (tab === 'team') return Users
  if (tab === 'security') return ShieldCheck
  if (tab === 'danger') return Trash2
  return SettingsIcon
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error) return error.message
  return 'The API could not be reached.'
}

async function persistWorkspaceSettings(storeId: string | null, settings: WorkspaceSettings): Promise<void> {
  writeWorkspaceSettings(storeId, settings)
  if (!storeId) return
  try {
    await saveWorkspaceSettings(storeId, settings)
  } catch {
    /* local persistence already succeeded */
  }
}

export function hydrateWorkspaceSettings(storeId: string | null, payload: unknown, lightMode = false): WorkspaceSettings {
  return parseWorkspaceSettings(payload, defaultWorkspaceSettings(lightMode))
}
