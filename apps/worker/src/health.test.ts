import { describe, expect, it } from 'vitest'
import { createWorkerHealthServer } from './health.js'

describe('F9 worker health server', () => {
  it('serves live and degraded readiness states on a free port', async () => {
    const state = { current: { startedAt: 1, lastTickAt: null as number | null, lastOutcome: 'starting', running: true } }
    const server = createWorkerHealthServer(0, state)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No health address')
    expect((await fetch(`http://127.0.0.1:${address.port}/health`)).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${address.port}/ready`)).status).toBe(503)
    state.current = { ...state.current, lastTickAt: 2, lastOutcome: 'idle' }
    expect((await fetch(`http://127.0.0.1:${address.port}/ready`)).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${address.port}/unknown`)).status).toBe(404)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
