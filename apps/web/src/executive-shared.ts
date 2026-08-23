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

/**
 * Saves an authenticated file download (see `requestFile` in api.ts) through
 * a temporary object-URL anchor with the `download` attribute. The app is
 * embedded in the Shopify admin iframe, so this never touches
 * `window.location` — and because the bytes were fetched with the App Bridge
 * bearer, it works where a tokenless `window.open(url)` would 401.
 */
export function saveDownloadedFile(file: Readonly<{ blob: Blob; filename: string | null }>, fallbackFilename: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  const url = URL.createObjectURL(file.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename || fallbackFilename
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return true
}
