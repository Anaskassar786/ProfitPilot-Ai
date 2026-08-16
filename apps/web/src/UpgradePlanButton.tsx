import { ArrowUpRight, Zap } from 'lucide-react'
export function UpgradePlanButton({ plan, onUpgrade, className = '' }: { plan: 'trial' | 'start' | 'growth' | 'commander'; onUpgrade: () => void; className?: string }) {
  if (plan === 'commander') return null
  const label = plan === 'trial' ? 'Trial' : plan === 'start' ? 'Start' : 'Growth'
  return <button type="button" className={`upgrade-plan-cta ${className}`} onClick={onUpgrade} aria-label={`${label} plan. Upgrade plan`}><Zap size={12} fill="currentColor" /><span><small>{label}</small> · Upgrade</span><ArrowUpRight size={12} /></button>
}
