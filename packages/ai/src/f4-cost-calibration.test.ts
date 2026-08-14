import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import { CostCapExceededError, CostMeter } from './cost.js'
import { CalibrationLedger } from './calibration.js'

describe('AI cost metering', () => {
  it('rejects invalid caps', () => expect(() => new CostMeter(-1)).toThrow('non-negative'))
  it('records micro-dollar usage per store and day', () => {
    const meter = new CostMeter(5, () => Date.parse('2024-06-12T12:00:00Z'))
    meter.record({ storeId: storeId('s'), model: 'm', promptTokens: 10, completionTokens: 5, inputRateMicroDollars: 2, outputRateMicroDollars: 4 })
    expect(meter.summary(storeId('s')).microDollars).toBe(40)
    expect(meter.summary(storeId('s')).calls).toBe(1)
  })
  it('enforces the five dollar daily cap', () => {
    const meter = new CostMeter(5, () => 100)
    meter.record({ storeId: storeId('s'), model: 'm', promptTokens: 5, completionTokens: 0, inputRateMicroDollars: 1_000_000, outputRateMicroDollars: 0 })
    expect(() => meter.record({ storeId: storeId('s'), model: 'm', promptTokens: 1, completionTokens: 0, inputRateMicroDollars: 1, outputRateMicroDollars: 0 })).toThrow(CostCapExceededError)
  })
  it('isolates cost caps by store', () => {
    const meter = new CostMeter(.00001, () => 100)
    meter.record({ storeId: storeId('one'), model: 'm', promptTokens: 1, completionTokens: 0, inputRateMicroDollars: 5, outputRateMicroDollars: 0 })
    expect(() => meter.record({ storeId: storeId('two'), model: 'm', promptTokens: 1, completionTokens: 0, inputRateMicroDollars: 5, outputRateMicroDollars: 0 })).not.toThrow()
  })
  it('returns remaining daily budget', () => expect(new CostMeter(5, () => 100).summary(storeId('s')).remainingMicroDollars).toBe(5_000_000))
  it('keeps entries scoped to the requested day', () => {
    let now = Date.parse('2024-06-12T12:00:00Z')
    const meter = new CostMeter(5, () => now)
    meter.record({ storeId: storeId('s'), model: 'm', promptTokens: 1, completionTokens: 0, inputRateMicroDollars: 10, outputRateMicroDollars: 0 })
    now += 86_400_000
    expect(meter.entriesFor(storeId('s'))).toHaveLength(0)
  })
})

describe('calibration caps and learning', () => {
  it('caps low-sample confidence at 75 percent', () => {
    const ledger = new CalibrationLedger()
    expect(ledger.calibrate('REVENUE_AGENT', .99).score).toBe(.75)
  })
  it('learns accepted outcomes after enough samples', () => {
    const ledger = new CalibrationLedger()
    for (let index = 0; index < 10; index += 1) ledger.record('REVENUE_AGENT', 'accepted')
    expect(ledger.calibrate('REVENUE_AGENT', .99).score).toBe(.99)
  })
  it('reduces confidence after rejected outcomes', () => {
    const ledger = new CalibrationLedger()
    for (let index = 0; index < 10; index += 1) ledger.record('REVENUE_AGENT', index < 5 ? 'accepted' : 'rejected')
    expect(ledger.calibrate('REVENUE_AGENT', .99).score).toBe(.5)
  })
  it('keeps agent calibration isolated', () => {
    const ledger = new CalibrationLedger()
    for (let index = 0; index < 10; index += 1) ledger.record('REVENUE_AGENT', 'accepted')
    expect(ledger.get('INVENTORY_AGENT').accepted).toBe(0)
  })
  it('maps confidence levels after capping', () => {
    const ledger = new CalibrationLedger()
    expect(ledger.calibrate('REVENUE_AGENT', .7).level).toBe('MEDIUM')
  })
})
