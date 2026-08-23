import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Typography floor (C3) + dead sample CSS (D4) regression guard.
 *
 * Merchant-facing text is never rendered below 12px — the single sanctioned
 * exception is the 15px notification count badge, a true micro-badge. The
 * legacy "PREVIEW ONLY" sample-preview styles were deleted; `.recs-sample-note`
 * is kept because the all-clear states still use it.
 */

const srcDir = fileURLToPath(new URL('.', import.meta.url))

function listCssFiles(dir: string): string[] {
  const entries: string[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${name.name}`
    if (name.isDirectory()) entries.push(...listCssFiles(path))
    else if (name.name.endsWith('.css')) entries.push(path)
  }
  return entries
}

const MICRO_BADGE_EXCEPTION = /\.notification-badge/

describe('web CSS typography floor', () => {
  it('has no merchant-facing font-size below 12px (micro-badge exception documented)', () => {
    const files = listCssFiles(srcDir)
    expect(files.length).toBeGreaterThan(25)
    const offenders: string[] = []
    for (const file of files) {
      const css = readFileSync(file, 'utf8')
      css.split('\n').forEach((line, index) => {
        const match = /font-size:\s*(\d+(?:\.\d+)?)px\b/.exec(line)
        if (!match) return
        if (Number.parseFloat(match[1] ?? '12') >= 12) return
        if (MICRO_BADGE_EXCEPTION.test(line)) return
        offenders.push(`${file.split('/').pop()}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('legacy sample preview CSS (D4)', () => {
  const recommendations = readFileSync(new URL('./recommendations.css', import.meta.url), 'utf8')

  it('no longer ships the PREVIEW ONLY sample-card rules', () => {
    expect(recommendations).not.toContain("PREVIEW ONLY")
    expect(recommendations).not.toContain('.recs-sample-wrap')
    expect(recommendations).not.toContain('.recs-sample-card')
    expect(recommendations).not.toContain('.recs-sample-chip')
    expect(recommendations).not.toContain('.recs-sample-actions')
  })

  it('keeps .recs-sample-note, which the all-clear states still use', () => {
    expect(recommendations).toContain('.recs-sample-note {')
    expect(recommendations).toContain('.recs-sample-note svg {')
  })
})
