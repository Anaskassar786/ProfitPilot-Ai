import { describe, expect, it } from 'vitest'
import { clampPosition, defaultCenterPosition, loadPosition, WIDGET_HEIGHT, WIDGET_WIDTH } from './FloatingVoiceWidget.js'

describe('Floating voice widget position persistence', () => {
  const viewport = { width: 1280, height: 800 }

  it('docks the strip near the bottom by default', () => {
    const position = defaultCenterPosition(viewport)
    expect(position.x).toBe(Math.round((1280 - WIDGET_WIDTH) / 2))
    expect(position.y).toBe(Math.round(800 - WIDGET_HEIGHT - 28))
  })

  it('clamps dragged positions inside the viewport with a margin', () => {
    expect(clampPosition(-500, -500, viewport)).toEqual({ x: 12, y: 12 })
    const far = clampPosition(9999, 9999, viewport)
    expect(far.x).toBe(1280 - WIDGET_WIDTH - 12)
    expect(far.y).toBe(800 - WIDGET_HEIGHT - 12)
  })

  it('loads and clamps a persisted position from storage', () => {
    const storage = { getItem: () => JSON.stringify({ x: 50, y: 60 }) }
    expect(loadPosition(storage, viewport)).toEqual({ x: 50, y: 60 })
    const offscreen = { getItem: () => JSON.stringify({ x: 5000, y: 5000 }) }
    const loaded = loadPosition(offscreen, viewport)
    expect(loaded.x).toBeLessThanOrEqual(viewport.width - WIDGET_WIDTH)
    expect(loaded.y).toBeLessThanOrEqual(viewport.height - WIDGET_HEIGHT)
  })

  it('falls back to the default dock when storage is missing or malformed', () => {
    const empty = { getItem: () => null }
    expect(loadPosition(empty, viewport)).toEqual(defaultCenterPosition(viewport))
    const malformed = { getItem: () => '{not json' }
    expect(loadPosition(malformed, viewport)).toEqual(defaultCenterPosition(viewport))
    const wrongShape = { getItem: () => JSON.stringify({ foo: 'bar' }) }
    expect(loadPosition(wrongShape, viewport)).toEqual(defaultCenterPosition(viewport))
  })
})
