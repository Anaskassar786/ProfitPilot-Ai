import { reconcileCharges } from '@profitpilot/billing'
import type { ChargeLedger, LocalCharge, ReconcileResult, ShopifyBillingClient, TrialAndGiftLedger, TrialRecord } from '@profitpilot/billing'

export async function runDailyBillingReconcile(ledger: ChargeLedger, clientFor: (charge: LocalCharge) => ShopifyBillingClient, now = Date.now()): Promise<ReconcileResult> { return reconcileCharges(ledger, clientFor, now) }
export function runHourlyTrialNudge(ledger: TrialAndGiftLedger, now = Date.now()): readonly TrialRecord[] { return ledger.expiringTrials(now) }
