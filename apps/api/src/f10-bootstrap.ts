import { Logger } from '@profitpilot/logger'
import { createBrevoMailer } from '@profitpilot/automation'
import { writePdf } from '@profitpilot/reporting'
import { OpenRouterClient } from '@profitpilot/ai'
import type { BadgeSignals } from '@profitpilot/ai'
import type { StoreId } from '@profitpilot/types'
import { createF9Bootstrap } from './f9-bootstrap.js'
import type { F9Bootstrap } from './f9-bootstrap.js'
import { StoreCoachService } from './store-coach-service.js'
import type { CoachMailer, CoachPdfWriter, StoreCoachServiceDependencies } from './store-coach-service.js'
import { resolveApiKeys } from './ai-keys.js'
import {
  PostgresAchievementRepository,
  PostgresCoachReportRepository,
  PostgresCoachUsageRepository,
  PostgresConversationRepository,
  PostgresGoalRepository,
  PostgresHealthScoreRepository,
  PostgresHuddleRepository,
  PostgresOnboardingRepository,
  PostgresPreferenceRepository,
  PostgresPriorityRepository,
  PostgresStreakRepository,
} from './store-coach-repositories.js'

/**
 * PR #48 — Store Coach bootstrap. Builds on the F9 chain and adds the Store
 * Coach service: a dedicated OpenRouter client (STORE_COACH_API_KEY), the
 * Postgres repositories from migration 0023, the shared cost ledger, the
 * Brevo SMTP mailer for Sunday digests, and a Commander-only PDF writer.
 */

export type StoreCoachBootstrap = Readonly<F9Bootstrap & { storeCoach: Readonly<{ service: StoreCoachService }> }>

const DEFAULT_COACH_MODELS = ['nvidia/nemotron-3-ultra:free', 'nvidia/nemotron-3-super:free'] as const

export function createStoreCoachBootstrap(rawEnv: Readonly<Record<string, string | undefined>>, logger = new Logger()): StoreCoachBootstrap | null {
  const f9 = createF9Bootstrap(rawEnv, logger)
  if (!f9) return null
  const env = rawEnv

  const enabled = (env.STORE_COACH_ENABLED ?? 'true').trim().toLowerCase() !== 'false'
  const resolvedKeys = resolveApiKeys(env)
  const provider = new OpenRouterClient({
    keys: resolvedKeys.keys,
    models: [env.STORE_COACH_MODEL_PRIMARY ?? DEFAULT_COACH_MODELS[0], env.STORE_COACH_MODEL_FALLBACK ?? DEFAULT_COACH_MODELS[1]].filter((model): model is string => Boolean(model?.trim())),
    timeoutMs: positiveNumber(env.AI_TIMEOUT_MS, 25_000),
    maxRetries: nonNegativeNumber(env.AI_MAX_RETRIES, 1),
    temperature: numberEnv(env.AI_TEMPERATURE, 0.35),
    maxTokens: 1_200,
    ...(logger ? { onFailure: (failure: import('@profitpilot/ai').ProviderFailureTelemetry) => logger.warn('Store Coach provider failure', { model: failure.model, status_code: failure.statusCode, failure_kind: failure.failureKind, attempt_number: failure.attemptNumber, duration_ms: failure.durationMs, request_id: failure.requestId }) } : {}),
  })

  const timezoneCache = new Map<string, string>()
  const storeTimezone = async (storeId: StoreId): Promise<string> => {
    const cached = timezoneCache.get(String(storeId))
    if (cached) return cached
    const result = await f9.database.query<{ timezone: string }>('SELECT timezone FROM stores WHERE id = $1 LIMIT 1', [storeId])
    const timezone = result.rows[0]?.timezone ?? 'UTC'
    timezoneCache.set(String(storeId), timezone)
    return timezone
  }
  const merchantDay = async (storeId: StoreId, at: Date): Promise<string> => {
    const timezone = await storeTimezone(storeId)
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
    const year = parts.find((part) => part.type === 'year')?.value ?? ''
    const month = parts.find((part) => part.type === 'month')?.value ?? ''
    const day = parts.find((part) => part.type === 'day')?.value ?? ''
    return `${year}-${month}-${day}`
  }
  const merchantHour = async (storeId: StoreId, at: Date): Promise<number> => {
    const timezone = await storeTimezone(storeId)
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).formatToParts(at)
    return Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  }

  const trialExpired = async (storeId: StoreId, plan: 'trial'): Promise<boolean> => {
    if (plan !== 'trial') return false
    const billing = await f9.billing.repository.get(String(storeId))
    if (billing && billing.state !== 'TRIAL_LIMITED' && billing.state !== 'PENDING_CONFIRMATION' && billing.state !== 'TRIAL_EXPIRED') return false
    const result = await f9.database.query<{ expires_at: Date }>('SELECT expires_at FROM trials WHERE shop_id = $1 AND consumed = false ORDER BY expires_at DESC LIMIT 1', [storeId])
    const expiresAt = result.rows[0]?.expires_at
    return expiresAt !== undefined && new Date(expiresAt).getTime() <= Date.now()
  }

  const merchantEmail = async (storeId: StoreId): Promise<string | null> => {
    const result = await f9.database.query<{ merchant_email: string }>('SELECT merchant_email FROM merchant_email_configs WHERE store_id = $1 AND verified = true LIMIT 1', [storeId])
    return result.rows[0]?.merchant_email ?? null
  }

  const mailer: CoachMailer | null = (() => {
    try {
      const transport = createBrevoMailer(env)
      const from = env.SMTP_FROM?.trim() || 'unconfigured@profitpilot.invalid'
      const fromName = env.SMTP_FROM_NAME?.trim() || 'ProfitPilot'
      return {
        sendWeeklyReview: async (input) => {
          await transport.send({ to: input.to, from, fromName, subject: input.subject, html: input.html })
        },
      }
    } catch {
      return null
    }
  })()

  const pdf: CoachPdfWriter | null = (() => {
    try {
      return {
        write: async (filename, rows) => {
          const file = writePdf(filename, rows as readonly Readonly<Record<string, string | number>>[])
          return file.filename
        },
      }
    } catch {
      return null
    }
  })()

  const extraSignals = async (storeId: StoreId): Promise<Partial<BadgeSignals>> => {
    const [recommendations, workflows, billing] = await Promise.all([
      f9.database.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM ai_recommendations WHERE store_id = $1 AND status IN ($2, $3)', [storeId, 'APPROVED', 'EXECUTED']),
      f9.database.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM workflows WHERE store_id = $1', [storeId]),
      f9.billing.repository.get(String(storeId)),
    ])
    return {
      recommendationsApproved: Number(recommendations.rows[0]?.count ?? 0),
      workflowsCreated: Number(workflows.rows[0]?.count ?? 0),
      commanderPlan: billing?.plan === 'commander',
      ...(env.STORE_COACH_BETA === 'true' ? { betaUser: true } : {}),
    }
  }

  const deps: StoreCoachServiceDependencies = {
    huddles: new PostgresHuddleRepository(f9.database),
    priorities: new PostgresPriorityRepository(f9.database),
    goals: new PostgresGoalRepository(f9.database),
    achievements: new PostgresAchievementRepository(f9.database),
    conversations: new PostgresConversationRepository(f9.database),
    preferences: new PostgresPreferenceRepository(f9.database),
    healthScores: new PostgresHealthScoreRepository(f9.database),
    reports: new PostgresCoachReportRepository(f9.database),
    streaks: new PostgresStreakRepository(f9.database),
    onboarding: new PostgresOnboardingRepository(f9.database),
    usage: new PostgresCoachUsageRepository(f9.database),
    analytics: f9.dataPlane.analytics,
    plan: async (storeId) => (await f9.billing.repository.get(String(storeId)))?.plan ?? 'trial',
    merchantDay,
    merchantHour,
    storeName: async (storeId) => (await f9.storeDirectory.get(storeId))?.shopDomain ?? null,
    merchantEmail,
    trialExpired: (storeId, plan) => trialExpired(storeId, plan as 'trial').then((value) => value),
    ai: provider,
    costs: {
      record: (input) => { void Promise.resolve(f9.ai.costs.record({ ...input, agent: 'STORE_COACH' })).catch(() => undefined) },
    },
    ...(mailer ? { mailer } : {}),
    ...(pdf ? { pdf } : {}),
    extraSignals,
    notificationUrl: `${env.APP_URL?.trim() || ''}/ai-growth-command`,
    rateLimitPerMinute: positiveNumber(env.STORE_COACH_RATE_LIMIT_PER_STORE, 30),
  }

  const service = new StoreCoachService(deps)
  void enabled
  logger.info('Store Coach AI provider', {
    configured: provider.configured,
    keySource: resolvedKeys.source ?? 'none',
    modelCount: provider.models.length,
  })
  return { ...f9, storeCoach: { service } }
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = value?.trim() ? Number(value) : fallback
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = value?.trim() ? Number(value) : fallback
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = value?.trim() ? Number(value) : fallback
  return Number.isFinite(parsed) ? parsed : fallback
}
