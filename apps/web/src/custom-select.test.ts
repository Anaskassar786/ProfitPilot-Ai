import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CustomSelect, customSelectKeyAction } from './CustomSelect.js'

const OPTIONS = [
  { value: 'name', label: 'Sort: Name' },
  { value: 'stock', label: 'Sort: Stock' },
  { value: 'value', label: 'Sort: Value' },
] as const

type SortValue = 'name' | 'stock' | 'value'

function render(props: Partial<Parameters<typeof CustomSelect<SortValue>>[0]> = {}): string {
  const base: Parameters<typeof CustomSelect<SortValue>>[0] = { value: 'name', options: OPTIONS, onChange: vi.fn(), ariaLabel: 'Sort inventory' }
  return renderToStaticMarkup(createElement(CustomSelect<SortValue>, { ...base, ...props }))
}

describe('shared dark listbox markup', () => {
  it('renders a button trigger, not a native select that would paint a white popup', () => {
    const html = render()
    expect(html).toContain('class="custom-select"')
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Sort: Name')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('<option')
  })

  it('exposes the accessible label and an optional prefix label', () => {
    const html = render({ label: 'Sort by' })
    expect(html).toContain('aria-label="Sort inventory"')
    expect(html).toContain('Sort by')
  })

  it('falls back to a placeholder when the value matches no option', () => {
    expect(render({ value: '' as 'name', placeholder: 'All categories' })).toContain('All categories')
  })
})

describe('listbox keyboard contract', () => {
  it('opens on the arrow, enter, and space keys', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ']) {
      expect(customSelectKeyAction(key, false, 0, 3)).toEqual({ type: 'open' })
    }
  })

  it('wraps the active option with the arrow keys while open', () => {
    expect(customSelectKeyAction('ArrowDown', true, 2, 3)).toEqual({ type: 'move', index: 0 })
    expect(customSelectKeyAction('ArrowUp', true, 0, 3)).toEqual({ type: 'move', index: 2 })
  })

  it('jumps to the first and last option with Home and End', () => {
    expect(customSelectKeyAction('Home', true, 2, 3)).toEqual({ type: 'move', index: 0 })
    expect(customSelectKeyAction('End', true, 0, 3)).toEqual({ type: 'move', index: 2 })
  })

  it('commits with enter or space and closes with escape or tab', () => {
    expect(customSelectKeyAction('Enter', true, 1, 3)).toEqual({ type: 'commit', index: 1 })
    expect(customSelectKeyAction(' ', true, 2, 3)).toEqual({ type: 'commit', index: 2 })
    expect(customSelectKeyAction('Escape', true, 1, 3)).toEqual({ type: 'close' })
    expect(customSelectKeyAction('Tab', true, 1, 3)).toEqual({ type: 'close' })
  })

  it('ignores unrelated keys and an empty option list', () => {
    expect(customSelectKeyAction('a', true, 0, 3)).toEqual({ type: 'none' })
    expect(customSelectKeyAction('ArrowDown', true, 0, 0)).toEqual({ type: 'none' })
    expect(customSelectKeyAction('Escape', true, 0, 0)).toEqual({ type: 'close' })
  })
})

describe('dark theme styling contract', () => {
  const css = new URL('./styles.css', import.meta.url)

  it('paints the popup from the card variable instead of the OS palette', async () => {
    const source = await (await import('node:fs/promises')).readFile(css, 'utf8')
    expect(source).toContain('.custom-select-menu { position: absolute;')
    expect(source).toContain('background: var(--card)')
    expect(source).toContain('.custom-select-menu li:hover, .custom-select-menu li.highlighted { color: var(--text); background: rgba(59,130,246,.12); }')
    expect(source).toContain('.custom-select-menu li[aria-selected="true"] { color: var(--blue-bright); }')
  })

  it('keeps the option list inside a real listbox for assistive tech', () => {
    const dom = new JSDOM(`<!doctype html><html lang="en"><body>${render()}</body></html>`)
    const trigger = dom.window.document.querySelector('.custom-select-trigger')
    expect(trigger?.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger?.tagName).toBe('BUTTON')
    dom.window.close()
  })
})

describe('page wiring', () => {
  it('replaces every native inventory dropdown with the shared listbox', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('./inventory.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('<select')
    expect(source).not.toContain('<option')
    expect(source.match(/<CustomSelect/g) ?? []).toHaveLength(4)
    for (const label of ['All categories', 'All vendors', 'All locations', "label: 'Name'", 'triggerLabel="Sort"']) expect(source).toContain(label)
  })

  it('keeps the Products page on the same shared component', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('./products.tsx', import.meta.url), 'utf8')
    expect(source).toContain("import { CustomSelect } from './CustomSelect.js'")
    expect(source).toContain('<CustomSelect icon={<SlidersHorizontal size={14} />}')
    expect(source).not.toContain('function ProductsDropdown')
    expect(source).not.toContain('<select')
  })
})

describe('interactive listbox behaviour in a DOM', () => {
  async function mount(onChange: (value: SortValue) => void) {
    const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
    const globals = globalThis as unknown as Record<string, unknown>
    for (const [key, value] of [['window', dom.window], ['document', dom.window.document], ['navigator', dom.window.navigator], ['HTMLElement', dom.window.HTMLElement], ['Node', dom.window.Node]] as const) {
      Object.defineProperty(globalThis, key, { configurable: true, value })
    }
    globals.IS_REACT_ACT_ENVIRONMENT = true
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const container = dom.window.document.getElementById('root')
    if (!container) throw new Error('missing root')
    const root = createRoot(container)
    await act(async () => { root.render(createElement(CustomSelect<SortValue>, { value: 'name', options: OPTIONS, onChange, ariaLabel: 'Sort inventory' })) })
    return { dom, act, container }
  }

  it('opens on click, highlights the selection, and commits a mouse choice', async () => {
    const onChange = vi.fn()
    const { dom, act, container } = await mount(onChange)
    const trigger = container.querySelector('button')
    if (!trigger) throw new Error('missing trigger')
    await act(async () => { trigger.click() })
    const listbox = container.querySelector('[role="listbox"]')
    expect(listbox).not.toBeNull()
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3)
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('Sort: Name')
    const second = container.querySelectorAll('[role="option"]')[1] as HTMLElement | undefined
    await act(async () => { second?.click() })
    expect(onChange).toHaveBeenCalledWith('stock')
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    dom.window.close()
  })

  it('opens with ArrowDown and commits the highlighted option with Enter', async () => {
    const onChange = vi.fn()
    const { dom, act, container } = await mount(onChange)
    const trigger = container.querySelector('button')
    if (!trigger) throw new Error('missing trigger')
    const press = async (key: string) => { await act(async () => { trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })) }) }
    await press('ArrowDown')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await press('ArrowDown')
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-1')
    await press('Enter')
    expect(onChange).toHaveBeenCalledWith('stock')
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    await press('Escape')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    dom.window.close()
  })

  it('closes when a click lands outside the control', async () => {
    const { dom, act, container } = await mount(vi.fn())
    const trigger = container.querySelector('button')
    await act(async () => { trigger?.click() })
    expect(container.querySelector('[role="listbox"]')).not.toBeNull()
    await act(async () => { dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })) })
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    dom.window.close()
  })
})
