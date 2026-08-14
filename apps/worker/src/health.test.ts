import { describe, expect, it } from 'vitest'
import { createWorkerHealthServer } from './health.js'

describe('F9 worker health server', () => {
  it('serves live and degraded readiness states on a free port', async () => {
    const state = { current: { startedAt: 1, lastTickAt: null as number | null, lastOutcome: 'starting', running: true } }
    let listeningCalled = false
    const server = createWorkerHealthServer(0, state, () => {
      listeningCalled = true
    })
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No health address')

    expect(listeningCalled).toBe(true)

    // /health and /live return 200
    const healthRes = await fetch(`http://127.0.0.1:${address.port}/health`)
    expect(healthRes.status).toBe(200)
    expect(await healthRes.json()).toEqual({ ok: true, service: 'worker', status: 'live' })

    const liveRes = await fetch(`http://127.0.0.1:${address.port}/live`)
    expect(liveRes.status).toBe(200)
    expect(await liveRes.json()).toEqual({ ok: true, service: 'worker', status: 'live' })

    // Trailing slash and query parameters
    const trailingSlashRes = await fetch(`http://127.0.0.1:${address.port}/health/?probe=1`)
    expect(trailingSlashRes.status).toBe(200)

    // /ready starts not ready (lastTickAt is null)
    expect((await fetch(`http://127.0.0.1:${address.port}/ready`)).status).toBe(503)

    // /ready becomes 200 after first tick
    state.current = { ...state.current, lastTickAt: 2, lastOutcome: 'idle' }
    expect((await fetch(`http://127.0.0.1:${address.port}/ready`)).status).toBe(200)

    // unknown routes return 404
    expect((await fetch(`http://127.0.0.1:${address.port}/unknown`)).status).toBe(404)

    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
