/**
 * Merchant-safe formatting for Shopify authorization failures.
 *
 * Shopify answers 401/403 (REST) or a GraphQL `ACCESS_DENIED` extension when
 * the installed access token does not hold the scope a mutation needs. The raw
 * transport message (`Shopify API request failed with 403`) is meaningless to a
 * merchant — worse, when it is concatenated per record it leaks internal ids
 * (`9414254756053 — Shopify API request failed with 403`).
 *
 * Every AI Command action handler funnels its Shopify failures through here so
 * the merchant always sees one actionable sentence plus a re-authorize CTA.
 */
import { ShopifyApiError } from '@profitpilot/shopify'
import type { AiCommandActionType } from '@profitpilot/ai'
import { PROFITPILOT_SHOPIFY_SCOPES_CSV } from './app-store-assets.js'

/** The exact merchant-facing copy shown for any missing-permission failure. */
export const SHOPIFY_PERMISSION_MESSAGE = '⚠️ Action requires additional Shopify permissions. Please re-authorize or reinstall ProfitPilot from Shopify Admin to grant updated permissions.'

/**
 * Scopes each write action needs. Used by both the preflight probe (before a
 * preview is rendered) and the execution-time 403 formatter, so the two can
 * never disagree about which permission a merchant is missing.
 *
 * - TAG_CUSTOMER writes tags back with `PUT /customers/{id}.json`.
 * - CREATE_DISCOUNT runs `discountCodeBasicCreate` (and `discountCodeDeactivate`
 *   on undo).
 *
 * Actions absent from this map do not touch the Shopify Admin API.
 */
export const ACTION_REQUIRED_SHOPIFY_SCOPES: Readonly<Partial<Record<AiCommandActionType, readonly string[]>>> = {
  TAG_CUSTOMER: ['write_customers'],
  CREATE_DISCOUNT: ['write_discounts'],
}

export function requiredShopifyScopesFor(actionType: AiCommandActionType): readonly string[] {
  return ACTION_REQUIRED_SHOPIFY_SCOPES[actionType] ?? []
}

/**
 * True when the error is a Shopify authorization rejection: HTTP 401/403, a
 * GraphQL `ACCESS_DENIED` error code, or the equivalent "Access denied" /
 * "requires ... scope" text Shopify returns on the GraphQL endpoint with a 200
 * status.
 */
export function isShopifyPermissionError(error: unknown): boolean {
  const status = shopifyStatus(error)
  if (status === 401 || status === 403) return true
  const text = errorText(error)
  return /\baccess[_ ]denied\b|\bforbidden\b|requires? (?:the )?[a-z_]*\bscope\b|missing (?:the )?[a-z_]*\bscope\b|not authorized|insufficient permission|approved access scope/i.test(text)
}

/** The HTTP status carried by a Shopify client error, when there is one. */
export function shopifyStatus(error: unknown): number | null {
  if (error instanceof ShopifyApiError) return error.status
  if (typeof error === 'object' && error !== null) {
    const record = error as { name?: unknown; status?: unknown }
    if (typeof record.status === 'number') return record.status
  }
  return null
}

export type ShopifyPermissionFailure = Readonly<{
  /** Merchant-facing sentence. Always starts with SHOPIFY_PERMISSION_MESSAGE. */
  message: string
  /** Stable machine reason recorded in `errorDetails.reason`. */
  reason: string
  /** The single scope that is missing, when it can be determined. */
  missingScope: string | null
  /** Deep link that restarts OAuth with the current scope list. */
  reauthorizeUrl: string | null
}>

/**
 * Formats a missing-permission failure. `scopes` is the permission(s) the
 * attempted call needs; `shopDomain` (when known) produces the re-authorize
 * CTA target.
 */
export function shopifyPermissionFailure(input: Readonly<{ scopes?: readonly string[]; shopDomain?: string | null; status?: number | null }> = {}): ShopifyPermissionFailure {
  const scopes = (input.scopes ?? []).filter((scope) => scope.trim().length > 0)
  const missingScope = scopes.length === 1 ? (scopes[0] ?? null) : null
  const detail = scopes.length > 0
    ? ` Missing permission${scopes.length === 1 ? '' : 's'}: ${scopes.join(', ')}.`
    : ''
  const status = typeof input.status === 'number' ? ` (Shopify returned HTTP ${input.status}.)` : ''
  return {
    message: `${SHOPIFY_PERMISSION_MESSAGE}${detail}${status}`,
    reason: missingScope ? `MISSING_${missingScope.toUpperCase()}_SCOPE` : 'SHOPIFY_PERMISSION_DENIED',
    missingScope,
    reauthorizeUrl: reauthorizeUrl(input.shopDomain ?? null),
  }
}

/**
 * Returns the merchant-safe permission failure when `error` is a Shopify
 * authorization rejection, otherwise null so callers keep their specific
 * (non-permission) error message.
 */
export function shopifyPermissionFailureFor(error: unknown, input: Readonly<{ scopes?: readonly string[]; shopDomain?: string | null }> = {}): ShopifyPermissionFailure | null {
  if (!isShopifyPermissionError(error)) return null
  return shopifyPermissionFailure({ ...input, status: shopifyStatus(error) })
}

/**
 * Single funnel for every merchant-visible Shopify error string: permission
 * rejections become the re-authorize copy, everything else keeps its original
 * (already merchant-safe) message.
 */
export function merchantSafeShopifyError(error: unknown, fallback: string, input: Readonly<{ scopes?: readonly string[]; shopDomain?: string | null }> = {}): string {
  const failure = shopifyPermissionFailureFor(error, input)
  if (failure) return failure.message
  const text = errorText(error).trim()
  return text.length > 0 ? text : fallback
}

/**
 * OAuth restart link. `/shopify/install` re-runs the authorization request with
 * the current PROFITPILOT_SHOPIFY_SCOPES list, which is what grants a newly
 * added scope to an existing installation.
 */
export function reauthorizeUrl(shopDomain: string | null | undefined): string | null {
  const shop = (shopDomain ?? '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return null
  return `/shopify/install?shop=${encodeURIComponent(shop)}`
}

/** The full scope list a re-install grants — handy for logs and diagnostics. */
export const REAUTHORIZE_SCOPES_CSV = PROFITPILOT_SHOPIFY_SCOPES_CSV

/**
 * The GraphQL Admin API answers HTTP 200 with a top-level `errors` array when
 * the token lacks a scope:
 *   { "errors": [{ "message": "Access denied for discountCodeBasicCreate field",
 *                  "extensions": { "code": "ACCESS_DENIED", "requiredAccess": "write_discounts" } }] }
 * A 200 never reaches the HTTP 403 path, so the body has to be inspected too.
 */
export function graphqlAccessDenied(body: unknown): boolean {
  const errors = graphqlErrors(body)
  if (errors.length === 0) return false
  return errors.some((entry) => {
    const extensions = isRecord(entry.extensions) ? entry.extensions : null
    const code = extensions && typeof extensions.code === 'string' ? extensions.code : ''
    if (/^ACCESS_DENIED$/i.test(code)) return true
    return isShopifyPermissionError(new Error(typeof entry.message === 'string' ? entry.message : ''))
  })
}

/** Merchant-readable text of a GraphQL top-level `errors` array (may be empty). */
export function graphqlErrorMessages(body: unknown): readonly string[] {
  return graphqlErrors(body)
    .map((entry) => (typeof entry.message === 'string' ? entry.message.trim() : ''))
    .filter((message) => message.length > 0)
}

function graphqlErrors(body: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(body)) return []
  const errors = body.errors
  if (Array.isArray(errors)) return errors.filter(isRecord)
  // Some REST-ish Shopify endpoints answer `{"errors": "Access denied"}`.
  if (typeof errors === 'string' && errors.trim()) return [{ message: errors }]
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown }
    if (typeof record.message === 'string') return record.message
    try { return JSON.stringify(error) } catch { return '' }
  }
  return error === undefined || error === null ? '' : String(error)
}
