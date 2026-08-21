import { Button } from '@shopify/polaris'
import { MagicIcon } from '@shopify/polaris-icons'

/**
 * Shared header CTA. Renders a Polaris `Button` with a visible
 * "Upgrade Plan" label (never icon-only). The wrapper span carries a stable
 * class so page CSS that squeezes small icon buttons inside header action rows
 * (`> button { width: 28px }`) can never collapse this CTA into a cramped,
 * icon-only control.
 *
 * Uses the native Polaris `tone="success"` primary (green) rather than the
 * default primary, whose flat near-black fill read as a broken "black box"
 * against the app's branded surfaces (merchant report: Reports page Generate /
 * Upgrade Plan buttons unreadable). Green matches the upgrade CTA language
 * already used across Automation and the Command Center.
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
        tone="success"
        icon={MagicIcon}
        onClick={onUpgrade}
        accessibilityLabel="Upgrade plan"
      >
        Upgrade Plan
      </Button>
    </span>
  )
}
