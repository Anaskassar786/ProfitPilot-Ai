import { Select } from '@shopify/polaris'
import type { ReactNode } from 'react'

export type SelectOption<Value extends string> = Readonly<{ value: Value; label: string }>

export type CustomSelectProps<Value extends string> = Readonly<{
  value: Value
  options: readonly SelectOption<Value>[]
  onChange: (value: Value) => void
  ariaLabel: string
  label?: string
  icon?: ReactNode
  className?: string
  placeholder?: string
  triggerLabel?: string
}>

export type CustomSelectKeyAction =
  | Readonly<{ type: 'none' }>
  | Readonly<{ type: 'open' }>
  | Readonly<{ type: 'close' }>
  | Readonly<{ type: 'move'; index: number }>
  | Readonly<{ type: 'commit'; index: number }>

export function customSelectKeyAction(key: string, open: boolean, activeIndex: number, length: number): CustomSelectKeyAction {
  if (length === 0) return key === 'Escape' || key === 'Tab' ? { type: 'close' } : { type: 'none' }
  if (key === 'ArrowDown') return open ? { type: 'move', index: (activeIndex + 1) % length } : { type: 'open' }
  if (key === 'ArrowUp') return open ? { type: 'move', index: (activeIndex - 1 + length) % length } : { type: 'open' }
  if (key === 'Home') return open ? { type: 'move', index: 0 } : { type: 'open' }
  if (key === 'End') return open ? { type: 'move', index: length - 1 } : { type: 'open' }
  if (key === 'Enter' || key === ' ' || key === 'Spacebar') return open ? { type: 'commit', index: activeIndex } : { type: 'open' }
  if (key === 'Escape' || key === 'Tab') return { type: 'close' }
  return { type: 'none' }
}

export function CustomSelect<Value extends string>({ value, options, onChange, ariaLabel, label, placeholder }: CustomSelectProps<Value>) {
  return (
    <Select
      label={label ?? ariaLabel}
      labelHidden={!label}
      options={options.map((option) => ({ label: option.label, value: option.value }))}
      value={value}
      {...(placeholder ? { placeholder } : {})}
      onChange={(next) => onChange(next as Value)}
    />
  )
}
