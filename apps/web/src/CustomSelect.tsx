import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

/**
 * Shared dark-theme listbox used everywhere a native `<select>` would break the
 * theme. Native selects render their popup with the OS palette (white on dark),
 * so Products (PR #25) and Inventory (PR #33) both use this instead.
 *
 * Behaviour contract:
 *  - `role="listbox"` / `role="option"` with `aria-expanded` and
 *    `aria-activedescendant` so screen readers announce the active option.
 *  - Keyboard: ArrowUp/ArrowDown, Home/End, Enter/Space, Escape, Tab.
 *  - Pointer: click to toggle, click an option to commit, outside click closes.
 *  - The selected option carries a check mark and `aria-selected="true"`.
 */

export type SelectOption<Value extends string> = Readonly<{ value: Value; label: string }>

export type CustomSelectProps<Value extends string> = Readonly<{
  value: Value
  options: readonly SelectOption<Value>[]
  onChange: (value: Value) => void
  ariaLabel: string
  /** Small muted prefix rendered before the current selection, e.g. "Sort by". */
  label?: string
  icon?: ReactNode
  className?: string
  /** Rendered when `value` matches no option (an empty filter, for example). */
  placeholder?: string
  /**
   * Optional fixed trigger text that replaces the selected option label.
   * Prefer showing the selected option (default) so merchants can see the
   * current choice at a glance. Use CSS width/ellipsis for overflow instead.
   */
  triggerLabel?: string
}>

/** Pure key handling so the interaction contract is unit-testable without a DOM. */
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

export function CustomSelect<Value extends string>({ value, options, onChange, ariaLabel, label, icon, className, placeholder, triggerLabel }: CustomSelectProps<Value>) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex]?.label : placeholder ?? options[0]?.label ?? ''

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (open) setActiveIndex(Math.max(0, selectedIndex))
  }, [open, selectedIndex])

  const commit = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const action = customSelectKeyAction(event.key, open, activeIndex, options.length)
    if (action.type === 'none') return
    // Tab must keep moving focus; every other handled key is ours to swallow.
    if (event.key !== 'Tab') event.preventDefault()
    if (action.type === 'open') { setOpen(true); setActiveIndex(Math.max(0, selectedIndex)) }
    else if (action.type === 'close') { setOpen(false); if (event.key === 'Escape') triggerRef.current?.focus() }
    else if (action.type === 'move') setActiveIndex(action.index)
    else commit(action.index)
  }

  return <div className={`custom-select${className ? ` ${className}` : ''}`} ref={rootRef}>
    <button
      type="button"
      ref={triggerRef}
      className="custom-select-trigger"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-option-${activeIndex}` : undefined}
      aria-label={ariaLabel}
      onClick={() => setOpen((isOpen) => !isOpen)}
      onKeyDown={onKeyDown}
    >
      {icon}
      {label ? <span>{label}</span> : null}
      <strong>{triggerLabel ?? selectedLabel}</strong>
      <ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <ul className="custom-select-menu" id={listId} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <li
        key={option.value}
        id={`${listId}-option-${index}`}
        role="option"
        aria-selected={option.value === value}
        className={index === activeIndex ? 'highlighted' : ''}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => commit(index)}
      >
        <span>{option.label}</span>
        {option.value === value ? <Check size={12} aria-hidden="true" /> : null}
      </li>)}
    </ul>}
  </div>
}
