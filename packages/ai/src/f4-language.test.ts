import { describe, expect, it } from 'vitest'
import { validateLanguageResponse, extractNumbers } from './language.js'

const evidence = [{ key: 'days', label: 'Days of cover', value: 4, source: 'inventory' }, { key: 'units', label: 'Units', value: 10, source: 'inventory' }]

describe('AI language guardrails', () => {
  it('accepts language with no numbers', () => expect(validateLanguageResponse('This product needs attention.', evidence, 100)).toContain('needs'))
  it('accepts numbers that deterministic evidence supplied', () => expect(validateLanguageResponse('There are 4 days of cover and 10 units.', evidence, 100)).toContain('4'))
  it('accepts the deterministic impact number', () => expect(validateLanguageResponse('The modeled impact is 100.', evidence, 100)).toContain('100'))
  it('rejects an invented number', () => expect(() => validateLanguageResponse('Expected lift is 999.', evidence, 100)).toThrow('unsupported number'))
  it('rejects PII language', () => expect(() => validateLanguageResponse('Email the customer name now.', evidence, 100)).toThrow('restricted PII'))
  it('rejects empty responses', () => expect(() => validateLanguageResponse('  ', evidence, 100)).toThrow('empty'))
  it('extracts currency and percentage numbers', () => expect(extractNumbers('Revenue is $1,200 and conversion is 12.5%')).toEqual([1200, 12.5]))
})
