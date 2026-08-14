import { describe, expect, it } from 'vitest'
import { InMemoryChargeLedger, TrialAndGiftLedger } from '@profitpilot/billing'
import { runDailyBillingReconcile, runHourlyTrialNudge } from './index.js'

describe('billing worker ticks', () => {
  it('runs a daily reconciliation tick', async () => { const ledger = new InMemoryChargeLedger(); ledger.add({ id: 'c', shopId: 's', plan: 'START', interval: 'MONTHLY', status: 'PENDING', createdAt: 0, lastVerifiedAt: null }); const result = await runDailyBillingReconcile(ledger, () => ({ verifyCharge: async () => ({ status: 'active' }) } as never), 100); expect(result.checked).toBe(1) })
  it('returns expiring trials for the hourly nudge tick', () => { const ledger = new TrialAndGiftLedger(); ledger.startTrial('s', 0, 1); expect(runHourlyTrialNudge(ledger, 0)).toHaveLength(1) })
})
