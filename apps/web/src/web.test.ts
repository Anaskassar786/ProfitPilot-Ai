import { describe, expect, it } from 'vitest'
import { PhaseNotImplementedError } from '@profitpilot/types'
import { WEB_PHASE, assertWebShellReady } from './index.js'

describe('web application boundary', () => {
  it('is explicitly reserved for F3', () => {
    expect(WEB_PHASE).toBe('F3')
    expect(() => assertWebShellReady()).toThrow(PhaseNotImplementedError)
  })
})
