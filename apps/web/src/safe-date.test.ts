import { describe, expect, it } from 'vitest'
import { safeAddDays, safeDate, safeDayKey, safeFormatDate, safeShortDay, safeTime, safeToISOString, todayDayKey } from './safe-date.js'

/** Every hostile input that reached production and blanked the Analytics page. */
const INVALID = [null, undefined, '', '   ', 'not-a-date', 'Invalid Date', {}, [], Number.NaN, new Date('nope'), true] as const

describe('safeDate', () => {
  it('returns null for null, undefined, empty strings and garbage', () => {
    for (const value of INVALID) expect(safeDate(value), `expected null for ${String(value)}`).toBeNull()
  })

  it('parses bare YYYY-MM-DD day keys as UTC midnight', () => {
    expect(safeDate('2026-08-14')?.toISOString()).toBe('2026-08-14T00:00:00.000Z')
  })

  it('parses the full ISO timestamps the API actually returns for date columns', () => {
    // Postgres `date` -> pg driver Date -> JSON -> this string. The PR #36 crash.
    expect(safeDate('2026-08-14T00:00:00.000Z')?.toISOString()).toBe('2026-08-14T00:00:00.000Z')
  })

  it('accepts Date instances and epoch numbers, rejecting invalid ones', () => {
    const date = new Date('2026-08-14T00:00:00.000Z')
    expect(safeDate(date)).toBe(date)
    expect(safeDate(date.valueOf())?.toISOString()).toBe('2026-08-14T00:00:00.000Z')
    expect(safeDate(new Date('bad'))).toBeNull()
    expect(safeDate(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('safeToISOString', () => {
  it('never throws RangeError on invalid input', () => {
    for (const value of INVALID) {
      expect(() => safeToISOString(value)).not.toThrow()
      expect(safeToISOString(value)).toBeNull()
    }
  })

  it('round-trips valid values', () => {
    expect(safeToISOString('2026-08-14')).toBe('2026-08-14T00:00:00.000Z')
  })
})

describe('safeDayKey', () => {
  it('normalises both bare keys and ISO timestamps to YYYY-MM-DD', () => {
    expect(safeDayKey('2026-08-14')).toBe('2026-08-14')
    expect(safeDayKey('2026-08-14T00:00:00.000Z')).toBe('2026-08-14')
  })

  it('returns the fallback for unusable values', () => {
    expect(safeDayKey(null)).toBeNull()
    expect(safeDayKey('not-a-date', '')).toBe('')
  })
})

describe('safeFormatDate', () => {
  it('shows an em dash fallback rather than "Invalid Date"', () => {
    for (const value of INVALID) expect(safeFormatDate(value)).toBe('—')
    expect(safeFormatDate(null, 'No date')).toBe('No date')
  })

  it('formats a real date', () => {
    expect(safeFormatDate('2026-08-14')).not.toBe('—')
  })
})

describe('safeShortDay', () => {
  it('falls back to the raw string so chart axes never read "Invalid Date"', () => {
    expect(safeShortDay('not-a-date')).toBe('not-a-date')
    expect(safeShortDay(null)).toBe('—')
    expect(safeShortDay(undefined)).toBe('—')
  })

  it('formats valid days and ISO timestamps identically', () => {
    expect(safeShortDay('2026-08-14')).toBe(safeShortDay('2026-08-14T00:00:00.000Z'))
  })
})

describe('safeTime', () => {
  it('returns null instead of NaN', () => {
    for (const value of INVALID) expect(safeTime(value)).toBeNull()
    expect(safeTime('2026-08-14')).toBe(Date.parse('2026-08-14T00:00:00.000Z'))
  })
})

describe('safeAddDays', () => {
  it('shifts a valid day key without throwing', () => {
    expect(safeAddDays('2026-08-14', -29)).toBe('2026-07-16')
    expect(safeAddDays('2026-08-14T00:00:00.000Z', -29)).toBe('2026-07-16')
    expect(safeAddDays('2026-08-14', 1)).toBe('2026-08-15')
  })

  it('returns null rather than crashing on invalid input', () => {
    for (const value of INVALID) expect(safeAddDays(value, -29)).toBeNull()
    expect(safeAddDays('2026-08-14', Number.NaN)).toBeNull()
  })

  it('crosses month and year boundaries correctly', () => {
    expect(safeAddDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(safeAddDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('todayDayKey', () => {
  it('always returns a valid, parseable day key', () => {
    const key = todayDayKey()
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(safeDate(key)).not.toBeNull()
  })
})

describe('regression: the exact PR #36 production crash', () => {
  it('reproduces the old unsafe expression throwing RangeError', () => {
    // What analytics.tsx:61 used to do, with the real API payload shape.
    const latest = '2026-08-14T00:00:00.000Z'
    expect(() => new Date(Date.parse(`${latest}T00:00:00Z`) - 29 * 86_400_000).toISOString())
      .toThrowError(RangeError)
  })

  it('handles the same payload safely through the utility', () => {
    const latest = '2026-08-14T00:00:00.000Z'
    expect(() => safeAddDays(latest, -29)).not.toThrow()
    expect(safeAddDays(latest, -29)).toBe('2026-07-16')
  })
})
