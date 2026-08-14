import { describe, expect, it } from 'vitest'
import { WEB_PHASE, WEB_SHELL_READY, webShellStatus } from './index.js'

describe('F3 web application shell', () => {
  it('reports the web shell as ready', () => expect(webShellStatus()).toEqual({ phase: 'F3', ready: true }))
  it('keeps the phase marker explicit', () => {
    expect(WEB_PHASE).toBe('F3')
    expect(WEB_SHELL_READY).toBe(true)
  })
})
