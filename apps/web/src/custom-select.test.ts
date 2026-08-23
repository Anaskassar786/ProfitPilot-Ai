// @vitest-environment jsdom
import { createElement } from 'react'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// jsdom does not implement matchMedia; Polaris' breakpoints module reads it at
// import time. Stub BEFORE dynamically importing any Polaris-touching module.
;(window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})

/**
 * CustomSelect contract (post-Polaris-migration): it is a thin wrapper around
 * the Polaris Select, so every dropdown across Products/Inventory/Orders/
 * Customers/Automation/Settings/Support shares one accessible, themeable
 * control. The wrapper guarantees:
 *   - a native <select> (keyboard + screen-reader complete) with all options,
 *   - a visible label when `label` is given and a visually hidden Polaris
 *     label otherwise (so the accessible name always exists),
 *   - `placeholder` support for "no value selected" states,
 *   - controlled `value` + `onChange` wiring.
 */
let CustomSelect: typeof import('./CustomSelect.js').CustomSelect
let customSelectKeyAction: typeof import('./CustomSelect.js').customSelectKeyAction
let AppProvider: typeof import('@shopify/polaris').AppProvider
let enTranslations: typeof import('@shopify/polaris/locales/en.json')

beforeAll(async () => {
  const module = await import('./CustomSelect.js')
  CustomSelect = module.CustomSelect
  customSelectKeyAction = module.customSelectKeyAction
  AppProvider = (await import('@shopify/polaris')).AppProvider
  enTranslations = (await import('@shopify/polaris/locales/en.json', { with: { type: 'json' } })) as never
})

const OPTIONS = [
  { value: 'name', label: 'Sort: Name' },
  { value: 'stock', label: 'Sort: Stock' },
  { value: 'value', label: 'Sort: Value' },
] as const

type SortValue = 'name' | 'stock' | 'value'

function render(props: Partial<Parameters<typeof CustomSelect<SortValue>>[0]> = {}): string {
  const base: Parameters<typeof CustomSelect<SortValue>>[0] = { value: 'name', options: OPTIONS, onChange: vi.fn(), ariaLabel: 'Sort inventory' }
  return renderToStaticMarkup(createElement(AppProvider, { i18n: enTranslations as never }, createElement(CustomSelect<SortValue>, { ...base, ...props })))
}

describe('Polaris select markup contract', () => {
  // The shared control is a thin wrapper over Polaris Select — the native
  // popup matches the embedded admin chrome instead of a custom listbox.
  it('renders a real native select carrying the current value and every option', () => {
    const html = render()
    expect(html).toContain('Polaris-Select')
    expect(html).toContain('<select')
    for (const label of ['Sort: Name', 'Sort: Stock', 'Sort: Value']) expect(html).toContain(label)
    expect(html).toContain('value="name"')
    expect(html).toContain('value="stock"')
    expect(html).toContain('value="value"')
  })

  it('always has an accessible name — visible label or visually hidden labelled-by', () => {
    // With an explicit label: a visible <label> programmatically tied (for/id)
    // replaces the ariaLabel as the accessible name.
    const withLabel = render({ label: 'Sort by' })
    expect(withLabel).toContain('Sort by')
    expect(withLabel).toContain('<label')
    expect(withLabel).toContain(' for="')
    expect(withLabel).not.toContain('Sort inventory')
    // Without a label the ariaLabel still names the control (visually hidden).
    const hidden = render()
    expect(hidden).toContain('Polaris-Labelled--hidden')
    expect(hidden).toContain('Sort inventory')
  })

  it('renders the placeholder as the leading option when provided', () => {
    const html = render({ value: '' as SortValue, placeholder: 'All categories' })
    expect(html).toContain('All categories')
  })

  it('forwards className and icon to a wrapper so page layout css keeps applying', () => {
    const html = render({ className: 'category-dropdown', icon: createElement('span', { className: 'my-filter-icon' }) })
    expect(html).toContain('category-dropdown')
    expect(html).toContain('my-filter-icon')
  })
})

describe('native interaction contract (keyboard complete by construction)', () => {
  it('fires onChange with the chosen value', async () => {
    const onChange = vi.fn()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const reactRoot = createRoot(root)
    await act(async () => {
      reactRoot.render(
        createElement(AppProvider, {
          i18n: enTranslations as never,
          children: createElement(CustomSelect<SortValue>, { value: 'name', options: OPTIONS, onChange, ariaLabel: 'Sort inventory' }),
        }),
      )
    })
    const select = root.querySelector('select')
    if (!select) throw new Error('missing native select')
    await act(async () => {
      select.value = 'stock'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('stock')
    await act(async () => reactRoot.unmount())
    root.remove()
  })
})

describe('legacy keyboard-mapper contract (kept for API stability)', () => {
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
  // In the jsdom environment import.meta.url is an http URL, so resolve
  // sources from the repository working directory instead.
  const readSource = (name: string) => import('node:fs/promises').then((fs) => fs.readFile(`apps/web/src/${name}`, 'utf8'))

  it('paints the popup from the card variable instead of the OS palette', async () => {
    const source = await readSource('styles.css')
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
  // In the jsdom environment import.meta.url is an http URL, so resolve
  // sources from the repository working directory instead.
  const readSource = (name: string) => import('node:fs/promises').then((fs) => fs.readFile(`apps/web/src/${name}`, 'utf8'))
  it('keeps every inventory dropdown on the shared CustomSelect', async () => {
    const source = await readSource('inventory.tsx')
    expect(source).not.toContain('<select')
    expect(source).not.toContain('<option')
    expect(source.match(/<CustomSelect/g) ?? []).toHaveLength(4)
    for (const label of ['All categories', 'All vendors', 'All locations', "label: 'Product name'", 'label="Sort by"']) expect(source).toContain(label)
    expect(source).toContain('inventory-toolbar-primary')
    expect(source).toContain('inventory-toolbar-filters')
    expect(source).not.toContain('triggerLabel="Sort"')
  })

  it('keeps the Products page on the same shared component', async () => {
    const source = await readSource('products.tsx')
    expect(source).toContain("import { CustomSelect } from './CustomSelect.js'")
    expect(source).toContain('<CustomSelect icon={<SlidersHorizontal size={14} />}')
    expect(source).not.toContain('function ProductsDropdown')
    expect(source).not.toContain('<select')
  })

  it('keeps the dark app readable for native popups via color-scheme', async () => {
    // Native select popups follow the UA color scheme, not author CSS. The app
    // is dark by default, so :root must opt into dark or every dropdown would
    // open a blinding white OS popup in dark mode.
    const source = await readSource('styles.css')
    expect(source).toContain('color-scheme: dark')
    expect(source).toContain('color-scheme: light')
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
