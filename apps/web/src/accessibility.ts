export type AccessibilityViolation = Readonly<{ id: string; impact: string | null; help: string; helpUrl: string; nodes: readonly string[] }>
export type AccessibilityAudit = Readonly<{ tool: 'axe-core'; violations: readonly AccessibilityViolation[]; passes: number; incomplete: number }>

export function runAxeGate(root: Element | Document): Promise<AccessibilityAudit> {
  return import('axe-core').then(({ default: axe }) => axe.run(root, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).then((result) => ({
    tool: 'axe-core',
    violations: result.violations.map((violation) => ({ id: violation.id, impact: violation.impact ?? null, help: violation.help, helpUrl: violation.helpUrl, nodes: violation.nodes.map((node) => node.html) })),
    passes: result.passes.length,
    incomplete: result.incomplete.length,
  }))
}

export function assertNoAccessibilityViolations(audit: AccessibilityAudit): void {
  if (audit.violations.length > 0) throw new AccessibilityGateError(audit.violations)
}

export function accessibilityGateEnabled(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.get('a11y') === '1'
}

export function installAccessibilityGate(root: Element, enabled: boolean): Promise<AccessibilityAudit | null> {
  if (!enabled) return Promise.resolve(null)
  return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => runAxeGate(root)).then((audit) => {
    assertNoAccessibilityViolations(audit)
    return audit
  })
}

export class AccessibilityGateError extends Error {
  public readonly violations: readonly AccessibilityViolation[]

  public constructor(violations: readonly AccessibilityViolation[]) {
    super(`Accessibility gate failed with ${violations.length} WCAG violation${violations.length === 1 ? '' : 's'}`)
    this.name = 'AccessibilityGateError'
    this.violations = violations
  }
}
