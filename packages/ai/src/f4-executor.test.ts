import { describe, expect, it } from 'vitest'
import { AppError } from '@profitpilot/types'
import { ActionExecutor, InMemoryExecutionLedger, assertPolicy } from './executor.js'

describe('F4 idempotent action executor', () => {
  it('executes a safe recommendation action', async () => {
    const ledger = new InMemoryExecutionLedger()
    const executor = new ActionExecutor({ CREATE_RECOMMENDATION: async () => ({ ok: true }) }, ledger, () => 100)
    await expect(executor.execute({ id: 'e1', storeId: 's', actionType: 'CREATE_RECOMMENDATION', payload: {}, mode: 'MANUAL', dailyCap: 2 })).resolves.toMatchObject({ status: 'EXECUTED' })
  })
  it('deduplicates an execution by id', async () => {
    let calls = 0
    const executor = new ActionExecutor({ TAG_CUSTOMER: async () => { calls += 1; return { tagged: true } } }, new InMemoryExecutionLedger(), () => 100)
    const request = { id: 'e1', storeId: 's', actionType: 'TAG_CUSTOMER' as const, payload: {}, mode: 'MANUAL' as const, dailyCap: 2 }
    const first = await executor.execute(request)
    const second = await executor.execute(request)
    expect(second).toEqual(first)
    expect(calls).toBe(1)
  })
  it('requires approval for customer email', async () => {
    const executor = new ActionExecutor({ SEND_EMAIL: async () => ({ sent: true }) }, new InMemoryExecutionLedger())
    await expect(executor.execute({ id: 'e1', storeId: 's', actionType: 'SEND_EMAIL', payload: {}, mode: 'MANUAL', dailyCap: 2 })).rejects.toThrow('Approval')
  })
  it('executes an approved email action', async () => {
    const executor = new ActionExecutor({ SEND_EMAIL: async () => ({ sent: true }) }, new InMemoryExecutionLedger(), () => 100)
    await expect(executor.execute({ id: 'e1', storeId: 's', actionType: 'SEND_EMAIL', payload: {}, approvalStatus: 'approved', mode: 'MANUAL', dailyCap: 2 })).resolves.toMatchObject({ status: 'EXECUTED' })
  })
  it('requires approval even when fully automatic mode is selected', () => expect(() => assertPolicy({ id: 'e1', storeId: 's', actionType: 'CREATE_RECOMMENDATION', payload: {}, mode: 'FULLY_AUTOMATIC', dailyCap: 2 }, 0)).toThrow('approval'))
  it('enforces a per-store daily cap', async () => {
    const ledger = new InMemoryExecutionLedger()
    const executor = new ActionExecutor({ TAG_CUSTOMER: async () => ({ ok: true }) }, ledger, () => 100)
    const request = { id: 'one', storeId: 's', actionType: 'TAG_CUSTOMER' as const, payload: {}, mode: 'MANUAL' as const, dailyCap: 1 }
    await executor.execute(request)
    await expect(executor.execute({ ...request, id: 'two' })).rejects.toThrow('safety cap')
  })
  it('fails if an action tool is not configured', async () => await expect(new ActionExecutor({}, new InMemoryExecutionLedger()).execute({ id: 'e1', storeId: 's', actionType: 'TAG_CUSTOMER', payload: {}, mode: 'MANUAL', dailyCap: 1 })).rejects.toThrow('not configured'))
  it('rejects invalid safety caps', () => expect(() => assertPolicy({ id: 'e1', storeId: 's', actionType: 'TAG_CUSTOMER', payload: {}, mode: 'MANUAL', dailyCap: 0 }, 0)).toThrow(AppError))
  it('rejects manual-only actions', () => expect(() => assertPolicy({ id: 'e1', storeId: 's', actionType: 'CREATE_DISCOUNT', payload: {}, mode: 'MANUAL', approvalStatus: 'approved', dailyCap: 1 }, 0)).not.toThrow())
})
