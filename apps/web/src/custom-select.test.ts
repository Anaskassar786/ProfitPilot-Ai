import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CustomSelect, customSelectKeyAction } from './CustomSelect.js'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }

/** main.tsx wraps every page in Polaris AppProvider (i18n) — mirror it here so
 *  components using the Polaris Button shim render outside an app shell. */
function renderWithAppProvider(element: import('react').ReactElement) {
  return renderToStaticMarkup(createElement(AppProvider, { i18n: enTranslations as never }, element))
}


const OPTIONS = [
  { value: 'name', label: 'Sort: Name' },
  { value: 'stock', label: 'Sort: Stock' },
  { value: 'value', label: 'Sort: Value' },
] as const

type SortValue = 'name' | 'stock' | 'value'

function render(props: Partial<Parameters<typeof CustomSelect<SortValue>>[0]> = {}): string {
  const base: Parameters<typeof CustomSelect<SortValue>>[0] = { value: 'name', options: OPTIONS, onChange: vi.fn(), ariaLabel: 'Sort inventory' }
  return renderWithAppProvider(createElement(CustomSelect<SortValue>, { ...base, ...props }))
}

describe('polaris select markup contract', () => {
  // The shared control is a thin wrapper over Polaris Select — the native
  // popup matches the embedded adminchrome instead of a custom listbox.
  it('renders a Polaris select carrying the current value and option labels', () => {
    const html = render()
    expect(html).toContain('Polaris-Select')
    expect(html).toContain('<select')
    expect(html).toContain('Sort: Name')
    expect(html).toContain('Sort: Stock')
  })

  it('exposes the accessible label and an optional prefix label', () => {
    // ariaLabel becomes the (visually hidden) Polaris label…
    expect(render()).toContain('Sort inventory')
    // …and an explicit visible label replaces it as the accessible name.
    const html = render({ label: 'Sort by' })
    expect(html).toContain('Sort by')
    expect(html).not.toContain('Sort inventory')
  })

  it('falls back to a placeholder when the value matches no option', () => {
    expect(render({ value: '' as 'name', placeholder: 'All categories' })).toContain('All categories')
  })

  it('forwards className and icon to a wrapper so page layout css keeps applying', () => {
    const html = render({ className: 'category-dropdown', icon: createElement('span', { className: 'my-filter-icon' }) })
    expect(html).toContain('category-dropdown')
    expect(html).toContain('my-filter-icon')
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

  it('keeps the control fully named for assistive tech', () => {
    const dom = new JSDOM(`<!doctype html><html lang="en"><body>${render()}</body></html>`)
    const select = dom.window.document.querySelector('select')
    expect(select).not.toBeNull()
    // Polaris labels the select via a real <label> association.
    const label = dom.window.document.querySelector(`label[for="${select?.id ?? ''}"]`)
    expect(label?.textContent).toContain('Sort inventory')
    dom.window.close()
  })
})

describe('page wiring', () => {
  it('replaces every native inventory dropdown with the shared listbox', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('./inventory.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('<select')
    expect(source).not.toContain('<option')
    expect(source.match(/<CustomSelect/g) ?? []).toHaveLength(4)
    for (const label of ['All categories', 'All vendors', 'All locations', "label: 'Product name'", 'label="Sort by"']) expect(source).toContain(label)
    expect(source).toContain('inventory-toolbar-primary')
    expect(source).toContain('inventory-toolbar-filters')
    expect(source).not.toContain('triggerLabel="Sort"')
  })

  it('keeps the Products page on the same shared component', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('./products.tsx', import.meta.url), 'utf8')
    expect(source).toContain("import { CustomSelect } from './CustomSelect.js'")
    expect(source).toContain('<CustomSelect icon={<SlidersHorizontal size={14} />}')
    expect(source).not.toContain('function ProductsDropdown')
    expect(source).not.toContain('<select')
  })
})

describe('native select interaction in a DOM', () => {
  async function mount(onChange: (value: SortValue) => void) {
    const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
    const globals = globalThis as unknown as Record<string, unknown>
    for (const [key, value] of [['window', dom.window], ['document', dom.window.document], ['navigator', dom.window.navigator], ['HTMLElement', dom.window.HTMLElement], ['Node', dom.window.Node]] as const) {
      Object.defineProperty(globalThis, key, { configurable: true, value })
    }
    // Polaris consults matchMedia for responsive behavior — jsdom lacks it.
    dom.window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as (query: string) => MediaQueryList
    globals.IS_REACT_ACT_ENVIRONMENT = true
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const container = dom.window.document.getElementById('root')
    if (!container) throw new Error('missing root')
    const root = createRoot(container)
    // main.tsx wraps every page in Polaris AppProvider (i18n) — mirror it.
    await act(async () => { root.render(createElement(AppProvider, { i18n: enTranslations as never }, createElement(CustomSelect<SortValue>, { value: 'name', options: OPTIONS, onChange, ariaLabel: 'Sort inventory' }))) })
    return { dom, act, container }
  }

  it('renders a native select with all options and commits a change with the chosen value', async () => {
    const onChange = vi.fn()
    const { dom, act, container } = await mount(onChange)
    const select = container.querySelector('select')
    if (!select) throw new Error('missing select')
    expect(select.options).toHaveLength(3)
    expect(Array.from(select.options).map((option) => option.label)).toEqual(['Sort: Name', 'Sort: Stock', 'Sort: Value'])
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, 'stock')
    await act(async () => { select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    expect(onChange).toHaveBeenCalledWith('stock')
    dom.window.close()
  })

  it('keeps the current value selected in the dom and drives onChange for each pick', async () => {
    const onChange = vi.fn()
    const { dom, act, container } = await mount(onChange)
    const select = container.querySelector('select')
    if (!select) throw new Error('missing select')
    expect(select.value).toBe('name')
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, 'value')
    await act(async () => { select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    expect(onChange).toHaveBeenLastCalledWith('value')
    dom.window.close()
  })
})
