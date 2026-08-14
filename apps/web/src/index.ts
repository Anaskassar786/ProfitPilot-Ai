export const WEB_PHASE = 'F3' as const
export const WEB_SHELL_READY = true

export function webShellStatus(): Readonly<{ phase: typeof WEB_PHASE; ready: true }> {
  return { phase: WEB_PHASE, ready: WEB_SHELL_READY }
}
