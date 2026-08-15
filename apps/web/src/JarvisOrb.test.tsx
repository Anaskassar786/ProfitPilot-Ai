import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JarvisOrb, orbAnimationProfile, projectParticle } from './JarvisOrb.js'

describe('Jarvis Canvas particle orb', () => {
  it('renders an accessible fixed-size wrapper with a decorative canvas', () => {
    const html = renderToStaticMarkup(createElement(JarvisOrb, { state: 'idle', size: 48, label: 'Jarvis idle' }))
    expect(html).toContain('aria-label="Jarvis idle"')
    expect(html).toContain('--jarvis-orb-size:48px')
    expect(html).toContain('<canvas aria-hidden="true"')
  })
  it('keeps projected particles inside the circular canvas boundary', () => {
    const size = 48
    for (const point of [{ x: 1, y: 0, z: 0, phase: 0 }, { x: -1, y: 0, z: 0, phase: 1 }, { x: 0, y: 1, z: 0, phase: 2 }, { x: 0, y: -1, z: 0, phase: 3 }, { x: 0, y: 0, z: 1, phase: 4 }]) {
      const projected = projectParticle(point, 2.4, size, 1.04)
      expect(Math.hypot(projected.x - size / 2, projected.y - size / 2) + projected.radius).toBeLessThan(size / 2)
    }
  })
  it('uses distinct motion and glow profiles for listening, thinking, speaking, warning, and sleeping', () => {
    expect(orbAnimationProfile('listening').speed).toBeGreaterThan(orbAnimationProfile('idle').speed)
    expect(orbAnimationProfile('thinking').pulseSpeed).toBeGreaterThan(orbAnimationProfile('idle').pulseSpeed)
    expect(orbAnimationProfile('speaking').pulseSpeed).toBeGreaterThan(orbAnimationProfile('thinking').pulseSpeed)
    expect(orbAnimationProfile('warning').amber).toBe(1)
    expect(orbAnimationProfile('sleeping').brightness).toBeLessThan(orbAnimationProfile('idle').brightness)
  })
})
