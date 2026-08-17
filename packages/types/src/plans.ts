export const PLAN_TIERS = ['trial', 'start', 'growth', 'commander'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

export type Entitlement = Readonly<{
  key: string
  limit: number | null
  enabled: boolean
}>

export const PLAN_LIMITS: Readonly<Record<PlanTier, Readonly<Record<string, number | null>>>> = {
  trial: { aiRecommendations: 10, activeAgents: 2, jarvisMessages: 60 },
  start: { aiRecommendations: 30, activeAgents: 3, jarvisMessages: 200 },
  growth: { aiRecommendations: 150, activeAgents: 5, jarvisMessages: 700 },
  commander: { aiRecommendations: null, activeAgents: 7, jarvisMessages: null },
}

export function limitFor(plan: PlanTier, entitlement: string): number | null {
  const limits = PLAN_LIMITS[plan]
  return Object.prototype.hasOwnProperty.call(limits, entitlement) ? limits[entitlement] ?? null : 0
}
