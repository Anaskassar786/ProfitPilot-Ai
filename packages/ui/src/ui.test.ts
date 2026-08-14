import { describe, expect, it } from 'vitest'
import { buttonClass, colors, spacing, typography } from './index.js'

describe('design system foundation', () => {
  it('contains the blueprint dark background', () => expect(colors.background).toBe('#0F1117'))
  it('contains eight spacing steps', () => expect(spacing).toHaveLength(8))
  it('exposes typography families', () => expect(typography.mono).toBe('JetBrains Mono'))
  it('creates a primary button class', () => expect(buttonClass('primary')).toBe('pp-button pp-button-primary'))
  it('adds a disabled state without changing the variant', () => expect(buttonClass('danger', true)).toContain('pp-button-disabled'))
})
