// @vitest-environment jsdom
import './jsdom-polaris-setup.js'
/**
 * ApprovalInbox — error-state contract.
 *
 * The inbox used to swallow fetch failures silently: the loading skeleton
 * stayed on screen forever because the catch block was missing. This test
 * pins the fix — a failed `getApprovals` must surface a friendly error UI
 * with a Retry button, not a permanently-spinning skeleton.
 */
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalInbox } from './ApprovalInbox.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const toasts: Array<{ message: string; kind?: string }> = []
let root: Root | null = null
let container: HTMLElement | null = null

const mount = async (): Promise<HTMLElement> => {
  const node = document.createElement('div')
  document.body.appendChild(node)
  container = node
  root = createRoot(node)
  await act(async () => {
    root?.render(createElement(StrictMode, null, createElement(ApprovalInbox, { storeId: 's-1', onBack: () => {}, onToast: (message, kind) => { if (kind) toasts.push({ message, kind }); else toasts.push({ message }) } })))
  })
  return node
}

const stubFetch = (responder: (url: string) => Response): void => {
  vi.stubGlobal('fetch', vi.fn(async (input: URL | string) => responder(String(input))) as unknown as typeof fetch)
}

describe('ApprovalInbox — error handling', () => {
  afterEach(() => {
    root?.unmount()
    root = null
    container?.remove()
    container = null
    toasts.length = 0
    vi.restoreAllMocks()
  })

  it('shows a friendly error UI with Retry when getApprovals fails (no infinite skeleton)', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { code: 'BOOM', message: 'Approvals could not be loaded' } }), { status: 500, headers: { 'content-type': 'application/json' } }))
    const node = await mount()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(node.textContent).toContain('Approvals could not be loaded')
    expect(node.textContent).toContain('Retry')
  })

  it('renders the empty state when there are no pending approvals', async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: true, data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const node = await mount()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(node.textContent).toContain('No actions waiting for approval')
  })
})
