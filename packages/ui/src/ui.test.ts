import { describe, expect, it } from 'vitest'
import { buttonClass, colors, spacing, typography } from './index.js'

describe('design system foundation', () => {
  it('uses Polaris background tokens', () => expect(colors.background).toBe('var(--p-color-bg)'))
  it('contains eight spacing steps', () => expect(spacing).toHaveLength(8))
  it('exposes typography families', () => expect(typography.body).toContain('--p-font-family-sans'))
  it('creates a primary button class', () => expect(buttonClass('primary')).toContain('Polaris-Button--primary'))
  it('adds a disabled state without changing the variant', () => expect(buttonClass('danger', true)).toContain('Polaris-Button--disabled'))
})
