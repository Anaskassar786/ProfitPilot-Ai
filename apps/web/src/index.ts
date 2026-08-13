import { PhaseNotImplementedError } from '@profitpilot/types'

export const WEB_PHASE = 'F3'

export function assertWebShellReady(): never {
  throw new PhaseNotImplementedError(WEB_PHASE, 'Embedded Shopify web shell')
}
