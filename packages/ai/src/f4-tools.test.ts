import { describe, expect, it } from 'vitest'
import { createActionTools } from './index.js'

describe('idempotent tool adapter boundary', () => {
  it('maps tag, email, and discount adapters to action types', () => {
    const tools = createActionTools({ tagCustomer: async () => ({ tag: 'vip' }), sendEmail: async () => ({ sent: true }), createDiscount: async () => ({ code: 'CODE' }) })
    expect(Object.keys(tools)).toEqual(['TAG_CUSTOMER', 'SEND_EMAIL', 'CREATE_DISCOUNT'])
  })
  it('keeps adapter outputs typed and delegated', async () => {
    const tools = createActionTools({ tagCustomer: async () => ({ tagged: true }), sendEmail: async () => ({ sent: true }), createDiscount: async () => ({ created: true }) })
    await expect(tools.TAG_CUSTOMER?.({ id: '1', storeId: 's', actionType: 'TAG_CUSTOMER', payload: {}, mode: 'MANUAL', dailyCap: 1 })).resolves.toEqual({ tagged: true })
  })
})
