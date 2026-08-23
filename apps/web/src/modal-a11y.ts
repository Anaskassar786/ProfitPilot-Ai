/**
 * A11y behavior for the app's custom modals.
 *
 * These modals intentionally keep the `modal-overlay`/`modal-card` design
 * system (Polaris `Modal` would fight the dark theme and existing markup), so
 * the required dialog behavior is applied here instead:
 *  - initial focus (first text field, else first focusable control)
 *  - Escape closes (callers pass their own close handler)
 *  - basic Tab focus trap while the modal is open
 *  - focus restored to the invoking element when the modal unmounts
 *
 * The JSX must still declare `role="dialog" aria-modal="true"` plus a
 * `aria-label`/`aria-labelledby` on the same element the ref points to.
 */
import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * Natural initial focus target: an explicit `[data-modal-autofocus]`
 * element when present, else the first text field (inputs, selects,
 * textareas) for form modals, else the first focusable control.
 */
export function initialFocusTarget(container: HTMLElement): HTMLElement | null {
  const focusable = getFocusableElements(container)
  if (focusable.length === 0) return null
  const tagged = container.querySelector<HTMLElement>('[data-modal-autofocus]')
  if (tagged && container.contains(tagged)) return tagged
  // tagName check (not instanceof) so the hook also runs in bare-node
  // test environments where the HTML* globals are undefined.
  const field = focusable.find((element) => element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT')
  return field ?? focusable[0] ?? null
}

export function useModalDialog(
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  open: boolean = true,
  initialFocus?: (container: HTMLElement) => HTMLElement | null,
): void {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape
  const initialFocusRef = useRef(initialFocus)
  initialFocusRef.current = initialFocus

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container || typeof document === 'undefined') return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = initialFocusRef.current ? initialFocusRef.current(container) : initialFocusTarget(container)
    target?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onEscapeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = getFocusableElements(container)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      const inside = active instanceof HTMLElement && container.contains(active)
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Restore focus to the element that opened the modal so keyboard and
      // screen-reader users do not land on <body>.
      if (previouslyFocused && previouslyFocused !== document.body && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [open, containerRef])
}
