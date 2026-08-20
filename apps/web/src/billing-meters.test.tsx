import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UsageMeterRow, visibleMeters } from './App.js'
import { HIDDEN_METER_KEYS } from '@profitpilot/types'
import type { UsageMeter } from './model.js'

/**
 * The PR (entitlement-meters) — every metered feature on the Billing page
 * must render honestly:
 *
 *   • Live counts win over stale billing_usage rows (`16 / 250`, never `0/250`)
 *   • Unlimited (`null` limit) renders `used · Unlimited`, never `0/0`
 *   • No NaN/Infinity in the progress bar `width` style
 *   • Hidden keys (SMS, campaigns, Jarvis) are filtered out so we never
 *     show a fake `0 / 0` for unproductized features
 *   • The agents meter is capacity, not consumption — no progress bar
 *   • Commander over fair-use thresholds gets a "High volume — fair use applies"
 *     hint
 */

const meter = (overrides: Partial<UsageMeter>): UsageMeter => ({ feature: 'products_sync', used: 0, limit: 100, ...overrides })

describe('Billing — UsageMeterRow', () => {
  it('renders real product count (16/250) — never 0/250 for a live count', () => {
    const html = renderToStaticMarkup(<UsageMeterRow meter={meter({ feature: 'products_sync', used: 16, limit: 250 })} plan="trial" />)
    expect(html).toContain('16 / 250')
    expect(html).not.toContain('0 / 250')
  })

  it('renders unlimited as "used · Unlimited" — never 0/0 or Infinity', () => {
    const html = renderToStaticMarkup(<UsageMeterRow meter={meter({ feature: 'products_sync', used: 12345, limit: null })} plan="commander" />)
    expect(html).toContain('12345 · Unlimited')
    expect(html).not.toContain('0 / 0')
    expect(html).not.toContain('Infinity')
    expect(html).not.toContain('NaN')
  })

  it('progress bar width is a valid percentage for limited cap (no NaN/Infinity)', () => {
    const html = renderToStaticMarkup(<UsageMeterRow meter={meter({ feature: 'ai_recommendations_month', used: 9, limit: 10 })} plan="trial" />)
    const widthMatch = html.match(/width:\s*([0-9.]+)%/)
    expect(widthMatch).not.toBeNull()
    const width = Number(widthMatch?.[1])
    expect(Number.isFinite(width)).toBe(true)
    expect(width).toBeGreaterThanOrEqual(0)
    expect(width).toBeLessThanOrEqual(100)
    // 9 / 10 = 90% → bar shows red (≥80)
    expect(width).toBe(90)
  })

  it('renders the agents meter as a capacity chip (no progress bar)', () => {
    const html = renderToStaticMarkup(<UsageMeterRow meter={meter({ feature: 'active_agents', used: 3, limit: 3 })} plan="start" />)
    expect(html).toContain('3 of 3 included')
    expect(html).toContain('Included')
    expect(html).not.toContain('billing-usage-bar')
  })

  it('shows the fair-use hint on Commander when a soft cap is exceeded', () => {
    const html = renderToStaticMarkup(
      <UsageMeterRow meter={meter({ feature: 'orders_sync_month', used: 150_000, limit: null })} plan="commander" />,
    )
    expect(html).toContain('fair use applies')
  })

  it('never shows the fair-use hint on non-Commander tiers even at huge volumes', () => {
    const html = renderToStaticMarkup(
      <UsageMeterRow meter={meter({ feature: 'orders_sync_month', used: 9_999, limit: 5_000 })} plan="growth" />,
    )
    expect(html).not.toContain('fair use applies')
  })

  it('hides the upgrade link when a meter is within its limit', () => {
    const html = renderToStaticMarkup(<UsageMeterRow meter={meter({ feature: 'ai_recommendations_month', used: 1, limit: 300 })} plan="growth" />)
    expect(html).not.toContain('Upgrade for higher limits')
  })

  it('shows the upgrade link only when the meter is at or above 100% of a limited cap', () => {
    const html = renderToStaticMarkup(<UsageMeterRow meter={meter({ feature: 'ai_recommendations_month', used: 300, limit: 300 })} plan="growth" />)
    expect(html).toContain('Upgrade for higher limits')
  })
})

describe('Billing — visibleMeters filter', () => {
  it('drops every key in HIDDEN_METER_KEYS so dead meters never show 0/0', () => {
    const meters: readonly UsageMeter[] = [
      meter({ feature: 'products_sync', used: 16, limit: 250 }),
      meter({ feature: 'sms_sends_month', used: 0, limit: 0 }),
      meter({ feature: 'active_campaigns', used: 0, limit: 0 }),
      meter({ feature: 'jarvis_messages_month', used: 0, limit: 0 }),
    ]
    const visible = visibleMeters(meters)
    expect(visible.map((m) => m.feature)).toEqual(['products_sync'])
    for (const hidden of HIDDEN_METER_KEYS) {
      expect(visible.find((m) => m.feature === hidden)).toBeUndefined()
    }
  })

  it('keeps every real feature in the meter list (does not over-filter)', () => {
    const meters: readonly UsageMeter[] = [
      'orders_sync_month',
      'products_sync',
      'customers_sync',
      'ai_recommendations_month',
      'active_agents',
      'automation_workflows',
      'email_sends_month',
      'team_members',
      'reports',
      'exports',
      'forecasting',
      'attribution',
      'ai_command_daily',
    ].map((feature) => meter({ feature, used: 0, limit: 100 }))
    const visible = visibleMeters(meters)
    expect(visible).toHaveLength(meters.length)
  })
})
