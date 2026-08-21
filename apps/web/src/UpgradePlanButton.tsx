import { Button } from '@shopify/polaris'
import { MagicIcon } from '@shopify/polaris-icons'

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
    <Button
      variant="primary"
      icon={MagicIcon}
      onClick={onUpgrade}
      accessibilityLabel="Upgrade plan"
    >
      Upgrade Plan
    </Button>
  )
}
