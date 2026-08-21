import { Button } from '@shopify/polaris'
import { MagicIcon } from '@shopify/polaris-icons'

/**
 * Shared header CTA. Renders a Polaris primary `Button` with a visible
 * "Upgrade Plan" label (never icon-only). The wrapper span carries a stable
 * class so page CSS that squeezes small icon buttons inside header action rows
 * (`> button { width: 28px }`) can never collapse this CTA into a cramped,
 * icon-only control.
 */
export function UpgradePlanButton({
  plan,
  onUpgrade,
  className = '',
}: {
  plan: 'trial' | 'start' | 'growth' | 'commander'
  onUpgrade: () => void
  className?: string
}) {
  if (plan === 'commander') return null
  return (
    <span className={`upgrade-plan-button-wrap ${className}`.trim()}>
      <Button
        variant="primary"
        icon={MagicIcon}
        onClick={onUpgrade}
        accessibilityLabel="Upgrade plan"
      >
        Upgrade Plan
      </Button>
    </span>
  )
}
