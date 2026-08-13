export const colors = {
  background: '#0F1117',
  card: '#1A1D27',
  border: '#2A2E38',
  primary: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  revenue: '#FBBF24',
} as const

export const spacing = [4, 8, 12, 16, 24, 32, 48, 64] as const
export const typography = { body: 'Inter', mono: 'JetBrains Mono', scale: [12, 14, 16, 20, 24, 32, 48] as const } as const
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

export function buttonClass(variant: ButtonVariant, disabled = false): string {
  return ['pp-button', `pp-button-${variant}`, disabled ? 'pp-button-disabled' : ''].filter(Boolean).join(' ')
}
