/**
 * PR #49 — shared executive page props and error helpers.
 */
import type { PlanTier } from '@profitpilot/types'
import type { WorkspaceContext } from './model.js'
import { ApiClientError } from './api.js'
import type { ExecutiveGate } from './executive-model.js'

export type ExecutivePageProps = Readonly<{
  context: WorkspaceContext
  plan: PlanTier
  gates: Readonly<Record<string, ExecutiveGate>>
  usagePercent?: Readonly<Record<string, number>>
  onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void
  onUpgrade: () => void
}>

export function errorMessageFrom(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error) return error.message
  return 'The API could not be reached.'
}

/** True when the 402/403 payload means the plan must be upgraded. */
export function isUpgradeError(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 402 || /upgrade required/i.test(error.message))
}
