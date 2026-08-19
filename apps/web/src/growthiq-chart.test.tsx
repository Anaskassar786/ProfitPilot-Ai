// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildTrajectoryHoverPoints,
  ExecutiveSlopeChart,
  ExecutiveTrajectoryChart,
  formatTrajectoryAxisDay,
  formatTrajectoryAxisMoney,
  formatTrajectoryDay,
  nearestTrajectoryPoint,
  niceTrajectoryTicks,
  type TrajectoryChartData,
} from './executive-charts.js'
import { projectTrajectory } from './growthiq-strategic.js'

const series = Array.from({ length: 8 }, (_, index) => ({
  day: `2026-08-${String(11 + index).padStart(2, '0')}`,
  value: 100 + index * 10,
}))

function chartData(): TrajectoryChartData {
  const projection = projectTrajectory(series)!
  return { historical: projection.historical, projected: projection.projected, band: projection.band }
}

describe('GrowthIQ trajectory hover math', () => {
  it('labels historical days Real and the 30-day extension Projected', () => {
    const points = buildTrajectoryHoverPoints(chartData())
    expect(points.length).toBe(38) // 8 real + 30 projected
    expect(points.slice(0, 8).every((point) => point.kind === 'Real')).toBe(true)
    expect(points.slice(8).every((point) => point.kind === 'Projected')).toBe(true)
    expect(points[0]!.day).toBe('2026-08-11')
    expect(points.at(-1)!.day).toBe('2026-09-17')
  })

  it('maps a viewBox X to the nearest day', () => {
    const points = buildTrajectoryHoverPoints(chartData())
    expect(nearestTrajectoryPoint([], 10)).toBeNull()
    expect(nearestTrajectoryPoint(points, points[0]!.x)!.day).toBe('2026-08-11')
    expect(nearestTrajectoryPoint(points, points[0]!.x)!.kind).toBe('Real')
    const last = points.at(-1)!
    expect(nearestTrajectoryPoint(points, last.x)!.kind).toBe('Projected')
    const mid = (points[3]!.x + points[4]!.x) / 2
    const nearest = nearestTrajectoryPoint(points, mid)!
    expect(['2026-08-14', '2026-08-15']).toContain(nearest.day)
  })

  it('formats chart days without timezone drift', () => {
    expect(formatTrajectoryDay('2026-08-18')).toBe('Aug 18, 2026')
    expect(formatTrajectoryDay('not-a-date')).toBe('not-a-date')
  })
})

describe('GrowthIQ trajectory axis system', () => {
  it('formats compact axis money for USD and INR', () => {
    expect(formatTrajectoryAxisMoney(2500, 'USD')).toBe('$2.5K')
    expect(formatTrajectoryAxisMoney(120000, 'INR')).toBe('₹1.2L')
    expect(formatTrajectoryAxisMoney(Number.NaN)).toBe('—')
  })

  it('formats short axis days', () => {
    expect(formatTrajectoryAxisDay('2026-08-18')).toBe('Aug 18')
    expect(formatTrajectoryAxisDay('not-a-date')).toBe('not-a-date')
  })

  it('builds a nice zero-based axis scale with human steps', () => {
    expect(niceTrajectoryTicks(470)).toEqual([0, 200, 400, 600])
    expect(niceTrajectoryTicks(8.3)).toEqual([0, 2.5, 5, 7.5, 10])
    expect(niceTrajectoryTicks(0)).toEqual([0, 1])
  })

  it('renders labeled axes, legend chips, and the Today marker', () => {
    const html = renderToStaticMarkup(createElement(ExecutiveTrajectoryChart, {
      data: chartData(),
      label: 'Revenue trajectory with 30-day trend projection',
      formatValue: (value: number) => `$${Math.round(value)}`,
    }))
    // Legend separates Real / Projected / Range honestly.
    expect(html).toContain('Real revenue')
    expect(html).toContain('Trend projection')
    expect(html).toContain('Likely range')
    // Y axis carries compact currency labels on nice-value gridlines.
    expect(html).toContain('gq-axis-gridline')
    expect(html).toContain('gq-axis-baseline')
    expect(html).toContain('gq-axis-label')
    expect(html).toContain('$200') // nice scale of a 100–470 range
    // X axis carries date ticks spanning real history into the projection.
    expect(html).toContain('Aug 11')
    expect(html).toContain('Sep 17')
    // The last-30 vs next-30 split is labeled.
    expect(html).toContain('Today')
    expect(html).toContain('gq-trajectory-today-pill')
    expect(html).toContain('gq-trajectory-projection') // dashed trend extension
  })
})

describe('GrowthIQ slope / projection-cone chart', () => {
  it('anchors the real run-rate and projection with a direction-tinted slope', () => {
    const html = renderToStaticMarkup(createElement(ExecutiveSlopeChart, {
      datum: {
        current: 3000,
        projected: 3600,
        growthRatePct: 20,
        confidencePct: 82,
        direction: 'growing',
        bandLow: 3300,
        bandHigh: 4200,
      },
      currency: 'USD',
      formatValue: (value: number) => `$${value.toLocaleString('en-US')}`,
    }))
    expect(html).toContain('gq-slope')
    expect(html).toContain('LAST 30 DAYS')
    expect(html).toContain('NEXT 30 DAYS')
    expect(html).toContain('$3,000')
    expect(html).toContain('$3,600')
    expect(html).toContain('20.0%')
    expect(html).toContain('gq-slope-whisker') // real confidence range
    expect(html).toContain('gq-slope-line positive')
  })

  it('uses a real confidence whisker from the projection band and declines honestly', () => {
    const html = renderToStaticMarkup(createElement(ExecutiveSlopeChart, {
      datum: {
        current: 5000,
        projected: 4200,
        growthRatePct: -16,
        confidencePct: 70,
        direction: 'declining',
        bandLow: 3900,
        bandHigh: 4600,
      },
      currency: 'USD',
      formatValue: (value: number) => `$${Math.round(value)}`,
    }))
    expect(html).toContain('gq-slope-line danger')
    expect(html).toContain('16.0%')
  })
})

describe('GrowthIQ trajectory chart interaction', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  function dispatchPointer(target: Element, type: string, clientX: number, clientY: number): void {
    const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
    target.dispatchEvent(new EventCtor(type, { bubbles: true, clientX, clientY }))
  }

  afterEach(async () => {
    if (root) {
      await act(async () => { root!.unmount() })
      root = null
    }
    container?.remove()
    container = null
  })

  it('shows a Real/Projected tooltip, date, and value on pointer move', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const data = chartData()
    await act(async () => {
      root!.render(createElement(ExecutiveTrajectoryChart, {
        data,
        label: 'Revenue trajectory with 30-day trend projection',
        formatValue: (value: number) => `$${Math.round(value)}`,
      }))
    })
    const svg = container.querySelector('svg') as SVGSVGElement
    const hit = container.querySelector('[data-testid="gq-trajectory-hit"]') as SVGRectElement
    expect(hit).not.toBeNull()
    expect(container.querySelector('[data-testid="gq-trajectory-tooltip"]')).toBeNull()

    svg.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 760, bottom: 200, width: 760, height: 200, toJSON: () => ({}),
    })

    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => {
      dispatchPointer(hit, 'pointermove', 12, 80)
      hit.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 80 }))
    })
    const tooltip = container.querySelector('[data-testid="gq-trajectory-tooltip"]') as HTMLElement
    expect(tooltip).not.toBeNull()
    expect(tooltip.getAttribute('data-kind')).toBe('Real')
    expect(tooltip.textContent).toContain('Real')
    expect(tooltip.textContent).toContain('Aug 11, 2026')
    expect(tooltip.textContent).toMatch(/\$\d+/)
    expect(container.querySelector('.gq-trajectory-cursor')).not.toBeNull()
    expect(container.querySelector('.gq-trajectory-active-dot')).not.toBeNull()

    await act(async () => {
      dispatchPointer(hit, 'pointermove', 750, 80)
    })
    const projected = container.querySelector('[data-testid="gq-trajectory-tooltip"]') as HTMLElement
    expect(projected.getAttribute('data-kind')).toBe('Projected')
    expect(projected.textContent).toContain('Projected')
    // Projected days carry the honest likely-range from the residual band.
    expect(projected.textContent).toContain('range $')

    await act(async () => {
      hit.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientX: 750, clientY: 80 }))
    })
    expect(container.querySelector('[data-testid="gq-trajectory-tooltip"]')).toBeNull()
  })
})
