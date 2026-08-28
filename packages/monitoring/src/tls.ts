import type { JsonObject } from '@profitpilot/logger'

export type TlsGuardResult = Readonly<{
  /** True when the process was found insecure and certificate verification was restored. */
  enforced: boolean
  previous: string | null
}>

/**
 * Deployment hardening: `NODE_TLS_REJECT_UNAUTHORIZED=0` is a Node switch that
 * disables TLS certificate verification process-wide — every outbound HTTPS
 * call (OpenRouter, Shopify Admin API, Upstash, Sentry, Postgres over TLS)
 * silently accepts a forged certificate, and Node prints a warning on the
 * first use of the weakened setting.
 *
 * It is easy for that variable to survive in a Render/Railway environment
 * group long after whatever proxy problem motivated it, so the process refuses
 * to inherit it: the value is restored before any socket is opened. Node reads
 * `process.env.NODE_TLS_REJECT_UNAUTHORIZED` lazily at connect time (any value
 * other than the exact string `'0'` means "verify"), so restoring it at startup
 * is enough to make every later connection verifying again.
 *
 * The correct fix is still to delete the variable from the deployment
 * dashboard — this guard is the safety net for the window before that happens.
 */
export function enforceSecureTls(
  env: Record<string, string | undefined>,
  log?: (message: string, context?: JsonObject) => void,
): TlsGuardResult {
  const current = env.NODE_TLS_REJECT_UNAUTHORIZED
  if (current === undefined || current.trim() !== '0') return { enforced: false, previous: current ?? null }
  env.NODE_TLS_REJECT_UNAUTHORIZED = '1'
  log?.('SECURITY: NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate verification — re-enabled at startup', {
    variable: 'NODE_TLS_REJECT_UNAUTHORIZED',
    action: 'restored_to_1',
    remediation: 'Remove NODE_TLS_REJECT_UNAUTHORIZED from the Render environment group; this guard should never fire.',
  })
  return { enforced: true, previous: current }
}
