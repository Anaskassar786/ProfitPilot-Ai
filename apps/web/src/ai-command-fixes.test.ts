import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AiCommandPage } from './ai-command-page.js'
import { AiCommandWorkspace, PostChatActivity } from './ai-command.js'
import type { AiCommandUsage } from './ai-command-model.js'

const context = { storeId: 'store-1', shop: 'demo.myshopify.com' }
const toast = vi.fn()
const billing = vi.fn()

// AiCommandPage reads window.location.hash at render time; shim it for SSR.
;(globalThis as unknown as { window: unknown }).window = { location: { hash: '' } }

describe('AI Command fixes (duplicate title)', () => {
  it('renders the AI Command title exactly once (no duplicated page header)', () => {
    const html = renderToStaticMarkup(createElement(AiCommandPage, { context, onToast: toast, onNavigateBilling: billing }))
    // The workspace sub-header is the only "AI Command" heading now.
    expect(html.match(/<h2>AI Command<\/h2>/g)?.length).toBe(1)
    // The old page-level duplicate <h1> header is gone.
    expect(html).not.toMatch(/<h1>AI Command<\/h1>/)
    expect(html).not.toMatch(/aic-page-title/)
  })

  it('keeps a single "Universal command center" eyebrow above the title', () => {
    const html = renderToStaticMarkup(createElement(AiCommandWorkspace, { context, plan: 'trial', onToast: toast, onNavigateBilling: billing }))
    expect(html).toContain('Universal command center')
    expect(html).toContain('aic-eyebrow')
    expect(html).toContain('One command controls everything')
  })
})

describe('AI Command fixes (empty space / activity timeline)', () => {
  const now = Date.parse('2026-08-18T12:00:00.000Z')
  const history: readonly AiCommandUsage[] = [
    { storeId: 's', usageDate: '2026-08-18', commandsUsed: 4, actionsExecuted: 0, tokensUsed: 0, costMicroDollars: 0, limit: 10, remaining: 6, actionsEnabled: false },
    { storeId: 's', usageDate: '2026-08-17', commandsUsed: 3, actionsExecuted: 0, tokensUsed: 0, costMicroDollars: 0, limit: 10, remaining: 7, actionsEnabled: false },
  ]

  it('renders quick follow-up actions with real prompts', () => {
    const html = renderToStaticMarkup(createElement(PostChatActivity, { usageHistory: history, now, onPrompt: vi.fn() }))
    expect(html).toContain('Quick follow-ups')
    for (const label of ['Ask about customers', 'Check inventory', 'Revenue analysis', 'Growth ideas']) {
      expect(html).toContain(label)
    }
  })

  it('renders a unique 7-day command activity timeline from real usage (no fake data)', () => {
    const html = renderToStaticMarkup(createElement(PostChatActivity, { usageHistory: history, now, onPrompt: vi.fn() }))
    expect(html).toContain('Your Command Activity')
    expect(html).toContain('Last 7 days')
    // Seven days are always shown; only real values are counted.
    expect(html.match(/aic-activity-day/g)?.length).toBe(7)
    expect(html).toContain('Total: 7 commands')
    expect(html).toContain('Time saved: ~21m')
    expect(html).not.toContain('$8,940')
    expect(html).not.toContain('fake')
  })

  it('shows a time-saved label in hours when the real usage justifies it', () => {
    const busy: readonly AiCommandUsage[] = [
      { ...history[0]!, commandsUsed: 20 },
      { ...history[1]!, commandsUsed: 15 },
    ]
    const html = renderToStaticMarkup(createElement(PostChatActivity, { usageHistory: busy, now, onPrompt: vi.fn() }))
    expect(html).toContain('Total: 35 commands')
    expect(html).toContain('Time saved: ~1.8h')
  })
})

describe('AI Command light theme stays scoped to light mode', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), 'ai-command.css')
  const css = readFileSync(root, 'utf8')

  it('scopes every new light override to .app-shell.light-mode (dark theme untouched)', () => {
    // The light-theme block we ship is guarded by `.app-shell.light-mode .aic-`.
    const block = css.split('AI Command — LIGHT THEME')[1] ?? ''
    const lines = block.split('\n')
    const offenders = lines.filter((line) => /^\s*\.aic-/.test(line))
    expect(offenders).toHaveLength(0)
    // Spot-check the required light palette is present.
    expect(css).toContain('.app-shell.light-mode .aic-shell { background: #F8FAFC; }')
    expect(css).toContain('.app-shell.light-mode .aic-title h2 { color: #0F172A; }')
    expect(css).toContain('.app-shell.light-mode .aic-composer textarea { background: #FFFFFF; border-color: #E2E8F0; color: #0F172A; }')
    expect(css).toContain('.app-shell.light-mode .aic-bubble.mine .aic-bubble-body { background: #F3E8FF;')
    expect(css).toContain('.app-shell.light-mode .aic-planbar { background: linear-gradient(90deg, #FEF3C7, #FDE68A);')
  })
})
