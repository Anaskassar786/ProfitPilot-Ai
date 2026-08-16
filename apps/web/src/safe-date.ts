/**
 * Defensive date helpers.
 *
 * Why this module exists
 * ----------------------
 * `analytics_revenue_daily.day` (and its sibling tables) are Postgres `date`
 * columns. The `pg` driver parses OID 1082 into a JavaScript `Date`, so by the
 * time a row is serialised by Express the client receives a full ISO timestamp
 * (`"2026-08-14T00:00:00.000Z"`), NOT the bare `"2026-08-14"` day key the web
 * types promise. Any code that assumed a bare day key and appended a time part
 * (`` `${day}T00:00:00Z` ``) produced `Invalid Date`, and calling
 * `.toISOString()` on it threw `RangeError: Invalid time value`, blanking the
 * whole Analytics page.
 *
 * Every date operation in the analytics surface must go through these helpers:
 * they never throw, and they always degrade to `null`/a fallback string.
 */

/** Matches a bare `YYYY-MM-DD` day key. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

/** Returns the Date only when it represents a real instant, else `null`. */
const finite = (date: Date): Date | null => (Number.isFinite(date.valueOf()) ? date : null)

/**
 * Parse an unknown value into a valid `Date`, or `null`.
 *
 * Accepts `Date` instances, epoch numbers, and strings. Bare `YYYY-MM-DD` day
 * keys are read in UTC so a day never drifts backwards in negative-offset
 * timezones. Never throws.
 */
export function safeDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value : null
  if (typeof value === 'number') return Number.isFinite(value) ? finite(new Date(value)) : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    return finite(new Date(DAY_KEY.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed))
  }
  return null
}

/** ISO-8601 string for `value`, or `null` when it is not a usable date. */
export function safeToISOString(value: unknown): string | null {
  const date = safeDate(value)
  return date ? date.toISOString() : null
}

/**
 * Normalise any date-ish value to a bare `YYYY-MM-DD` UTC day key.
 *
 * This is the workhorse that repairs API payloads: it turns both
 * `"2026-08-14T00:00:00.000Z"` and `"2026-08-14"` into `"2026-08-14"`.
 */
export function safeDayKey(value: unknown, fallback: string | null = null): string | null {
  const iso = safeToISOString(value)
  return iso ? iso.slice(0, 10) : fallback
}

/** Locale date string for `value`, or `fallback` when it is not a usable date. */
export function safeFormatDate(value: unknown, fallback = '—'): string {
  const date = safeDate(value)
  return date ? date.toLocaleDateString() : fallback
}

/**
 * Short `MMM D` label used on chart axes and signal rows.
 * Falls back to the original string so an axis never renders "Invalid Date".
 */
export function safeShortDay(value: unknown, fallback = '—'): string {
  const date = safeDate(value)
  if (!date) return typeof value === 'string' && value.trim() ? value : fallback
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Epoch milliseconds for `value`, or `null`. Never `NaN`. */
export function safeTime(value: unknown): number | null {
  const date = safeDate(value)
  return date ? date.valueOf() : null
}

/**
 * Shift a date-ish value by `days` and return a bare `YYYY-MM-DD` UTC day key.
 * Returns `null` instead of throwing when the input is unusable.
 */
export function safeAddDays(value: unknown, days: number): string | null {
  const time = safeTime(value)
  if (time === null || !Number.isFinite(days)) return null
  return safeDayKey(new Date(time + days * 86_400_000))
}

/** Today's UTC day key. Always valid — safe to use as a last-resort default. */
export function todayDayKey(): string {
  return new Date().toISOString().slice(0, 10)
}
