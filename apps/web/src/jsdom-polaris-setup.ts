/** Polaris reads `window.matchMedia` at module load. Stub it before App imports. */
const matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return false },
})

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: matchMedia })
}
