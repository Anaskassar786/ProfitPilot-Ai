import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./settings.css', import.meta.url), 'utf8')

describe('Settings professional theme contracts', () => {
  it('ships a dedicated light surface matching the merchant spec', () => {
    expect(css).toContain('.app-shell.light-mode .settings-nav')
    expect(css).toContain('.app-shell.light-mode .settings-panel')
    expect(css).toContain('background: rgb(255, 255, 255)')
    expect(css).toContain('color: rgb(17, 24, 39)')
    expect(css).toContain('.app-shell.light-mode .setting-input')
    expect(css).toContain('.app-shell.light-mode .settings-toggle')
    expect(css).toContain('.app-shell.light-mode .settings-nav-item.active')
  })

  it('hides the floating assistant and honours reduced motion from settings', () => {
    expect(css).toContain('.app-shell.hide-jarvis .jarvis-orb-wrap')
    expect(css).toContain('.app-shell.reduce-motion')
    expect(css).toContain('.app-shell.jarvis-pos-bottom-left .jarvis-orb-wrap')
  })

  it('styles confirmation dialogs and danger actions', () => {
    expect(css).toContain('.settings-modal')
    expect(css).toContain('.button.danger')
    expect(css).toContain('.settings-nav-item.danger')
  })
})
