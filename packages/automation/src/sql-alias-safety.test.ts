import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Regression guard for the Automation "Internal server error" outage.
 *
 * `GET /automation/summary` returned a 500 because `RunRepository.summary()`
 * aliased an aggregate as a bare `month`:
 *
 *   count(*) FILTER (...) month        -- syntax error at or near "month"
 *   count(*) FILTER (...) AS month     -- correct
 *
 * In PostgreSQL, `MONTH` (like YEAR/DAY/HOUR/MINUTE/SECOND and the reserved
 * words below) is a key word that *requires* the `AS` keyword when used as a
 * column label. Omitting `AS` is a hard parse error, so the query failed at
 * runtime on every request even though it type-checked and unit-tested fine
 * against the in-memory repository.
 *
 * See: PostgreSQL Appendix C, "SQL Key Words" — entries marked
 * "non-reserved, requires AS" and "reserved, requires AS".
 */

// Key words that cannot be used as a bare (AS-less) column label.
const REQUIRES_AS = [
  'year', 'month', 'day', 'hour', 'minute', 'second',
  'filter', 'over', 'within', 'values', 'between', 'limit', 'offset',
  'left', 'right', 'full', 'inner', 'outer', 'cross', 'natural', 'join',
  'order', 'group', 'having', 'window', 'union', 'intersect', 'except',
  'from', 'where', 'select', 'into', 'on', 'using', 'collate',
  'and', 'or', 'not', 'null', 'is', 'in', 'like', 'ilike', 'similar',
  'when', 'then', 'else', 'case', 'all', 'isnull', 'notnull',
]

function sourceFiles(): readonly string[] {
  const directory = dirname(fileURLToPath(import.meta.url))
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(directory, name))
}

describe('SQL column aliases', () => {
  it('never uses an AS-less alias that PostgreSQL reserves', () => {
    const offenders: string[] = []

    for (const file of sourceFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        for (const keyword of REQUIRES_AS) {
          // Matches `) keyword,` or `) keyword FROM` — an alias with no AS.
          // `CASE ... END,` is excluded because END closes the expression.
          const bareAlias = new RegExp(`\\)\\s+${keyword}\\s*(,|\\s+FROM\\b)`, 'i')
          if (!bareAlias.test(line)) continue
          if (new RegExp(`\\bEND\\s*(,|\\s+FROM\\b)`, 'i').test(line) && keyword === 'end') continue
          offenders.push(`${file.split('/').slice(-1)[0]}:${index + 1} → bare "${keyword}" alias (use "AS ${keyword}")`)
        }
      })
    }

    expect(offenders).toEqual([])
  })

  it('keeps the automation summary aggregates explicitly aliased', () => {
    const directory = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(directory, 'execution-repositories.ts'), 'utf8')

    // The exact aggregates behind GET /automation/summary.
    for (const alias of ['today', 'month', 'previous', 'completed', 'failed', 'waiting']) {
      expect(source).toContain(`AS ${alias}`)
    }
  })
})
