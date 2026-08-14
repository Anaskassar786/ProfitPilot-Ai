import { describe, expect, it } from 'vitest'
import { SixHourlyReportTick } from './report-job.js'

describe('F8 six-hourly report tick', () => {
  it('runs only at a UTC six-hour boundary', async () => {
    let calls = 0
    const tick = new SixHourlyReportTick(async () => { calls += 1 })
    await expect(tick.tick(Date.parse('2024-01-01T05:59:00.000Z'))).resolves.toBe('idle')
    await expect(tick.tick(Date.parse('2024-01-01T06:00:00.000Z'))).resolves.toBe('ran')
    expect(calls).toBe(1)
  })
})
