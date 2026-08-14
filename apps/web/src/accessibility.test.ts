import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { AccessibilityGateError, accessibilityGateEnabled, assertNoAccessibilityViolations, installAccessibilityGate, runAxeGate } from './accessibility.js'

function withAccessibleDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html lang="en"><head><title>ProfitPilot</title></head><body><main><h1>ProfitPilot</h1><button type="button">Continue</button></main></body></html>')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => ({ measureText: () => ({ width: 0 }) }) })
  return dom
}

describe('WCAG 2.2 AA axe gate', () => {
  it('runs axe-core and blocks violations', async () => {
    const dom = withAccessibleDom()
    const audit = await runAxeGate(dom.window.document.body)
    expect(audit.tool).toBe('axe-core')
    expect(audit.violations).toEqual([])
    expect(() => assertNoAccessibilityViolations(audit)).not.toThrow()
    await expect(installAccessibilityGate(dom.window.document.body, true)).resolves.toMatchObject({ tool: 'axe-core', violations: [] })
    dom.window.close()
  })

  it('supports an explicit blocking URL gate and typed failures', async () => {
    expect(accessibilityGateEnabled('?a11y=1')).toBe(true)
    expect(accessibilityGateEnabled('?a11y=0')).toBe(false)
    expect(accessibilityGateEnabled('')).toBe(false)
    const error = new AccessibilityGateError([{ id: 'color-contrast', impact: 'serious', help: 'Fix contrast', helpUrl: 'https://dequeuniversity.com', nodes: ['<button>'] }])
    expect(error.name).toBe('AccessibilityGateError')
    expect(error.violations).toHaveLength(1)
    expect(() => assertNoAccessibilityViolations({ tool: 'axe-core', violations: error.violations, passes: 0, incomplete: 0 })).toThrow('WCAG')
    await expect(installAccessibilityGate(withAccessibleDom().window.document.body, false)).resolves.toBeNull()
  })
})
