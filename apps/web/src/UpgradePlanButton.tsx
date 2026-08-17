import { ArrowUpRight, Zap } from 'lucide-react'

/**
 * Global Upgrade CTA — single clean button "Upgrade Plan" across all pages.
 * No Trial/Start/Growth label, no overlapping text.
 * Commander returns null (already top tier).
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
    <button
      type="button"
      className={`upgrade-plan-cta ${className}`}
      onClick={onUpgrade}
      aria-label="Upgrade plan"
      style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
    >
      <Zap size={14} fill="currentColor" />
      <span>Upgrade Plan</span>
      <ArrowUpRight size={14} />
    </button>
  )
}
