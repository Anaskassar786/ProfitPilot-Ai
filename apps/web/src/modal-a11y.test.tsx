// @vitest-environment jsdom
/**
 * useModalDialog — the a11y behavior applied to the app's custom modals
 * (role/aria attributes live in the JSX; this pins the behavior): initial
 * focus, Escape-to-close, a basic Tab focus trap, and focus restoration to
 * the invoking element on close.
 */
import { act, createElement, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement, Root } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFocusableElements, initialFocusTarget, useModalDialog } from './modal-a11y.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function TestModal({
  onEscape,
  open = true,
  initialFocus,
  children,
}: {
  onEscape: () => void
  open?: boolean
  initialFocus?: (container: HTMLElement) => HTMLElement | null
  children?: ReactElement
}) {
  const ref = useRef<HTMLDivElement>(null)
  useModalDialog(ref, onEscape, open, initialFocus)
  return (
    <div>
      <button data-testid="opener" type="button">Open</button>
      {open && (
        <div ref={ref} className="modal-card" role="dialog" aria-modal="true">
          {children}
        </div>
      )}
    </div>
  )
}

function render(element: ReactElement): void {
  const node = document.createElement('div')
  document.body.appendChild(node)
  container = node
  root = createRoot(node)
  act(() => {
    root?.render(element)
  })
}

function dispatchKey(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('initialFocusTarget', () => {
  it('prefers the first text field over buttons', () => {
    const el = document.createElement('div')
    el.innerHTML = '<button>a</button><input name="x" /><button>b</button>'
    const target = initialFocusTarget(el)
    expect(target?.tagName).toBe('INPUT')
  })

  it('falls back to the first focusable control when there is no field', () => {
    const el = document.createElement('div')
    el.innerHTML = '<button>a</button><button>b</button>'
    expect(initialFocusTarget(el)?.textContent).toBe('a')
  })

  it('honors an explicit [data-modal-autofocus] element', () => {
    const el = document.createElement('div')
    el.innerHTML = '<button>a</button><button data-modal-autofocus>b</button><input />'
    expect(initialFocusTarget(el)?.textContent).toBe('b')
  })

  it('returns null when nothing is focusable', () => {
    const el = document.createElement('div')
    el.innerHTML = '<span>plain text</span>'
    expect(initialFocusTarget(el)).toBeNull()
  })
})

describe('useModalDialog', () => {
  it('moves initial focus to the first text field when the modal opens', () => {
    const onEscape = vi.fn()
    render(
      createElement(TestModal, { onEscape },
        createElement('button', { type: 'button', 'data-testid': 'first' }, 'First'),
        createElement('input', { 'data-testid': 'field', name: 'f' }),
        createElement('button', { type: 'button', 'data-testid': 'last' }, 'Last')),
    )
    expect(document.activeElement?.getAttribute('data-testid')).toBe('field')
  })

  it('falls back to the first focusable control when there is no field', () => {
    const onEscape = vi.fn()
    render(
      createElement(TestModal, { onEscape },
        createElement('button', { type: 'button', 'data-testid': 'first' }, 'First'),
        createElement('button', { type: 'button', 'data-testid': 'last' }, 'Last')),
    )
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first')
  })

  it('closes on Escape', () => {
    const onEscape = vi.fn()
    render(
      createElement(TestModal, { onEscape },
        createElement('button', { type: 'button', 'data-testid': 'only' }, 'Only')),
    )
    dispatchKey('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('traps Tab: wrapping from the last control back to the first', () => {
    const onEscape = vi.fn()
    render(
      createElement(TestModal, { onEscape },
        createElement('button', { type: 'button', 'data-testid': 'first' }, 'First'),
        createElement('button', { type: 'button', 'data-testid': 'last' }, 'Last')),
    )
    const last = container?.querySelector<HTMLElement>('[data-testid="last"]')
    act(() => { last?.focus() })
    dispatchKey('Tab')
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first')
  })

  it('traps Shift+Tab: wrapping from the first control back to the last', () => {
    const onEscape = vi.fn()
    render(
      createElement(TestModal, { onEscape },
        createElement('button', { type: 'button', 'data-testid': 'first' }, 'First'),
        createElement('button', { type: 'button', 'data-testid': 'last' }, 'Last')),
    )
    const first = container?.querySelector<HTMLElement>('[data-testid="first"]')
    act(() => { first?.focus() })
    dispatchKey('Tab', { shiftKey: true })
    expect(document.activeElement?.getAttribute('data-testid')).toBe('last')
  })

  it('restores focus to the invoking element when the modal unmounts', () => {
    const onEscape = vi.fn()
    let setOpen: (value: boolean) => void = () => {}
    function Harness() {
      const [open, setInnerOpen] = useState(false)
      setOpen = setInnerOpen
      return createElement(TestModal, { onEscape, open },
        createElement('input', { name: 'f', 'data-testid': 'field' }))
    }
    render(createElement(Harness))
    // Realistic flow: the user focuses the trigger, the modal opens (the
    // effect then records the trigger as the previously focused element).
    const opener = document.querySelector<HTMLElement>('[data-testid="opener"]')
    act(() => { opener?.focus() })
    act(() => { setOpen(true) })
    expect(document.activeElement?.getAttribute('data-testid')).toBe('field')
    act(() => { setOpen(false) })
    expect(document.activeElement).toBe(opener)
  })

  it('installs no behavior while open is false', () => {
    const onEscape = vi.fn()
    render(
      createElement(TestModal, { onEscape, open: false },
        createElement('button', { type: 'button', 'data-testid': 'never' }, 'Never')),
    )
    // No dialog rendered, so nothing is focused by the hook.
    expect(document.activeElement?.getAttribute('data-testid')).toBeNull()
    dispatchKey('Escape')
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('keeps focus on the dialog when the container has no focusable elements', () => {
    const onEscape = vi.fn()
    render(
      createElement(TestModal, { onEscape },
        createElement('div', null, 'progress…')),
    )
    // Nothing to focus, but Escape still closes.
    dispatchKey('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)
  })
})

describe('getFocusableElements', () => {
  it('excludes disabled controls and negative tabindex', () => {
    const el = document.createElement('div')
    el.innerHTML = '<button>a</button><button disabled>b</button><a href="#">c</a><span tabindex="-1">d</span><span tabindex="0">e</span>'
    expect(getFocusableElements(el).map((node) => node.textContent)).toEqual(['a', 'c', 'e'])
  })
})
