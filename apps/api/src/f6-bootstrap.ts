import { MerchantEmailVerifier, PostgresTemplateRepository, PostgresWorkflowRepository, ThreadLedger } from '@profitpilot/automation'
import { createF5Bootstrap } from './f5-bootstrap.js'
import type { F5Bootstrap } from './f5-bootstrap.js'
import type { AutomationRouteDependencies } from './automation-routes.js'

export type F6Bootstrap = Readonly<F5Bootstrap & { automation: AutomationRouteDependencies }>
export function createF6Bootstrap(env: Readonly<Record<string, string | undefined>>): F6Bootstrap | null {
  const f5 = createF5Bootstrap(env)
  if (!f5) return null
  return { ...f5, automation: { workflows: new PostgresWorkflowRepository(f5.database), templates: new PostgresTemplateRepository(f5.database), emailVerifier: new MerchantEmailVerifier(env.TRACKING_SECRET?.trim() || 'development-tracking-secret'), tickets: new ThreadLedger() } }
}
