export const colors = {
  background: 'var(--p-color-bg)',
  card: 'var(--p-color-bg-surface)',
  border: 'var(--p-color-border)',
  primary: 'var(--p-color-bg-fill-brand)',
  success: 'var(--p-color-bg-fill-success)',
  warning: 'var(--p-color-bg-fill-warning)',
  danger: 'var(--p-color-bg-fill-critical)',
  revenue: 'var(--p-color-bg-fill-warning)',
} as const

export const spacing = [4, 8, 12, 16, 24, 32, 48, 64] as const
export const typography = { body: 'var(--p-font-family-sans)', mono: 'ui-monospace', scale: [12, 14, 16, 20, 24, 32, 48] as const } as const
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

export function buttonClass(variant: ButtonVariant, disabled = false): string {
  return ['Polaris-Button', variant === 'primary' ? 'Polaris-Button--primary' : variant === 'danger' ? 'Polaris-Button--critical' : '', disabled ? 'Polaris-Button--disabled' : ''].filter(Boolean).join(' ')
}
