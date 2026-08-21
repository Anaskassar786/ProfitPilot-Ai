// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QaChartBoard } from './qa-board.js'
import { QA_AREAS, QA_BUGS, QA_FAKE_AUDIT } from './qa-data.js'

/**
 * QA Chart Board smoke test.
 *
 * Renders the board (dev-workspace QA surface) against a mocked backend and
 * asserts the summary metrics, the three board columns, the bug register, the
 * fake-data audit, and the live server check all render. Any React console
 * error fails the test, and any endpoint answering 500 turns the live check
 * red — which this test also asserts renders as a visible server error row.
 */

const consoleErrors: string[] = []
let root: Root | null = null

const envelope = (data: unknown): unknown => ({ ok: true, data, requestId: 'qa-board-test' })

describe('QA Chart Board', () => {
  beforeEach(() => {
    consoleErrors.length = 0
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(String(args[0]))
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/ready')) {
        return new Response(JSON.stringify(envelope({ ok: false, checks: [] })), { status: 503, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/session/context')) return new Response(JSON.stringify(envelope({ storeId: null, shop: null })), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify(envelope([])), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.innerHTML = ''
  })

  it('renders the full board without React errors', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(createElement(StrictMode, null, createElement(QaChartBoard, { context: { storeId: null, shop: null } })))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

    const text = host.textContent ?? ''
    expect(text).toContain('Health grade: B')
    expect(text).toContain('PASSING AREAS')
    expect(text).toContain('FOUND & FIXED')
    expect(text).toContain('BUG REGISTER')
    expect(text).toContain('ANTI-FAKE AUDIT')
    expect(text).toContain('LIVE SERVER CHECK')
    expect(text).toContain('BILLING & LIMITS VERIFICATION')
    expect(consoleErrors.filter((line) => !line.includes('act('))).toEqual([])
  })

  it('marks a 5xx endpoint as a visible server error in the live check', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/ready')) return new Response(JSON.stringify(envelope({ ok: false, checks: [] })), { status: 503, headers: { 'content-type': 'application/json' } })
      if (url.includes('/session/context')) return new Response(JSON.stringify(envelope({ storeId: null, shop: null })), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.includes('/catalog')) return new Response(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }), { status: 500, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify(envelope([])), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(createElement(StrictMode, null, createElement(QaChartBoard, { context: { storeId: 'store-1', shop: 'qa-store.myshopify.com' } })))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

    const text = host.textContent ?? ''
    expect(text).toContain('HTTP 500')
    expect(text).toContain('SERVER ERROR')
    expect(text).toContain('2 server errors')
  })

  it('keeps the dataset internally consistent', () => {
    expect(QA_AREAS).toHaveLength(20)
    for (const area of QA_AREAS) {
      expect(area.checks.length).toBeGreaterThan(0)
      for (const check of area.checks) expect(['PASS', 'FIXED', 'DEFERRED', 'OUT_OF_SCOPE']).toContain(check.status)
    }
    expect(QA_BUGS.some((bug) => bug.status === 'FIXED')).toBe(true)
    expect(QA_FAKE_AUDIT.length).toBeGreaterThan(10)
  })
})
