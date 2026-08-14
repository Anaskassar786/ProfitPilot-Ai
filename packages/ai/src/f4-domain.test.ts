import { describe, expect, it } from 'vitest'
import { actionRisk, confidenceLevel } from './domain.js'

describe('F4 decision domain guards', () => {
  it('maps high confidence', () => expect(confidenceLevel(.9)).toBe('HIGH'))
  it('maps medium confidence', () => expect(confidenceLevel(.6)).toBe('MEDIUM'))
  it('maps low confidence', () => expect(confidenceLevel(.59)).toBe('LOW'))
  it('marks safe actions', () => expect(actionRisk('TAG_CUSTOMER')).toBe('SAFE'))
  it('marks approval actions', () => expect(actionRisk('SEND_EMAIL')).toBe('APPROVAL_REQUIRED'))
  it('marks discount actions as approval-required', () => expect(actionRisk('CREATE_DISCOUNT')).toBe('APPROVAL_REQUIRED'))
  it('marks internal alerts safe', () => expect(actionRisk('INTERNAL_ALERT')).toBe('SAFE'))
})
