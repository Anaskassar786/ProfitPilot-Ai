import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { greetingForHour } from './recommendations-model.js'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(join(here, 'App.tsx'), 'utf8')

// ---------------------------------------------------------------------------
// Dashboard hero greeting — regression contract.
//
// The dashboard used to hardcode "Good morning" no matter what time it was,
// while Store Coach correctly said "Good evening". The hero title must be
// derived from the merchant's local clock (same greetingForHour helper the
// Recommendations page uses) and must end with the store display name, e.g.
// "Good evening, Commander".
// ---------------------------------------------------------------------------

describe('dashboard hero greeting', () => {
  it('derives the title from the local clock instead of hardcoding Good morning', () => {
    // The old bug: a literal 'Good morning' title for any connected store.
    expect(appSource).not.toContain("context.storeId ? 'Good morning'")
    // The fix: the shared time-of-day helper drives the dashboard hero.
    expect(appSource).toContain("import { greetingForHour } from './recommendations-model.js'")
    expect(appSource).toContain('greetingForHour(new Date().getHours())')
  })

  it('ends the greeting with the store display name (…, Commander)', () => {
    expect(appSource).toContain('`${greeting}, ${displayName}`')
  })

  it('keeps the connect-store title when no store is linked', () => {
    expect(appSource).toContain("'Connect your Shopify store'")
  })

  it('uses the same hour buckets as Recommendations and Store Coach', () => {
    expect(greetingForHour(8)).toBe('Good morning')
    expect(greetingForHour(11)).toBe('Good morning')
    expect(greetingForHour(12)).toBe('Good afternoon')
    expect(greetingForHour(16)).toBe('Good afternoon')
    expect(greetingForHour(17)).toBe('Good evening')
    expect(greetingForHour(23)).toBe('Good evening')
  })
})
