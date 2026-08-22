import type { ChargeLedger, LocalCharge, ReconcileResult, TrialRecord } from '@profitpilot/billing'
import { giftCodesFromEnv, PostgresChargeLedger, PostgresTrialGiftStore, ShopifyBillingClient, reconcileCharges } from '@profitpilot/billing'
import { AesGcmCipher } from '@profitpilot/crypto'
import { PostgresDatabase, PostgresStoreDirectory, databaseConfigFromEnv } from '@profitpilot/db'
import type { Logger } from '@profitpilot/logger'
import { PostgresTokenRecordStore, TokenVault } from '@profitpilot/shopify'
import { AppError, storeId } from '@profitpilot/types'

/** Anything that can report ACTIVE trials expiring within a window. */
export type TrialNudgeSource = Readonly<{ expiringTrials(now?: number, withinMs?: number): readonly TrialRecord[] | Promise<readonly TrialRecord[]> }>

export async function runDailyBillingReconcile(ledger: ChargeLedger, clientFor: (charge: LocalCharge) => ShopifyBillingClient | Promise<ShopifyBillingClient>, now = Date.now()): Promise<ReconcileResult> { return reconcileCharges(ledger, clientFor, now) }
export async function runHourlyTrialNudge(source: TrialNudgeSource, now = Date.now()): Promise<readonly TrialRecord[]> { return source.expiringTrials(now) }

export type BillingJobs = Readonly<{
  /** Verifies pending Shopify charges and resolves their local subscription state. */
  reconcile: () => Promise<ReconcileResult>
  /** Surfaces ACTIVE trials expiring within the next 24 hours. */
  nudge: () => Promise<readonly TrialRecord[]>
}>

/**
 * Builds the Postgres-backed billing background jobs for the worker process.
 *
 * Returns `null` (and the worker keeps running its other jobs) when the worker
 * is not configured with the secrets the billing path needs — a worker without
 * `DATABASE_URL`/`ENCRYPTION_KEY` only runs the queue + discovery jobs.
 */
export function createBillingJobs(env: Readonly<Record<string, string | undefined>>, logger: Logger | null = null): BillingJobs | null {
  const encryptionKey = env.ENCRYPTION_KEY?.trim()
  const databaseUrl = env.DATABASE_URL?.trim()
  if (!encryptionKey || !databaseUrl) return null

  const database = new PostgresDatabase(databaseConfigFromEnv(env))
  const directory = new PostgresStoreDirectory(database)
  const vault = new TokenVault(AesGcmCipher.fromHex(encryptionKey), new PostgresTokenRecordStore(database))
  const ledger = new PostgresChargeLedger(database)
  const trialStore = new PostgresTrialGiftStore(database, giftCodesFromEnv(env))
  const apiVersion = env.SHOPIFY_API_VERSION?.trim() || '2026-07'
  const testMode = billingTestMode(env)

  const clientFor = async (charge: LocalCharge): Promise<ShopifyBillingClient> => {
    const connection = await directory.get(storeId(charge.shopId))
    if (!connection) throw new AppError('NOT_FOUND', 'Shopify store is not registered', 404, { storeId: charge.shopId })
    const token = await vault.get(connection.shopDomain)
    if (!token) {
      throw new AppError('DEPENDENCY_ERROR', 'Shopify access token is missing. Hard refresh the embedded app to reconnect this store, then retry.', 503, { storeId: charge.shopId, reason: 'SHOPIFY_TOKEN_MISSING', action: 'HARD_REFRESH' })
    }
    return new ShopifyBillingClient({ shop: connection.shopDomain, accessToken: token, apiVersion, testMode, logger })
  }

  return {
    reconcile: () => runDailyBillingReconcile(ledger, (charge) => clientFor(charge)),
    nudge: () => runHourlyTrialNudge(trialStore),
  }
}

function billingTestMode(env: Readonly<Record<string, string | undefined>>): boolean | 'auto' {
  const value = env.SHOPIFY_BILLING_TEST_MODE?.trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  return 'auto'
}
