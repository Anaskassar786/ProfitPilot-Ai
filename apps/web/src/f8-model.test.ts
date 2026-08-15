import { describe, expect, it } from 'vitest'
import { reduceJarvisSession } from './f8-model.js'
import type { JarvisSessionLifecycle } from './f8-model.js'

describe('Jarvis session lifecycle', () => {
  const starting: JarvisSessionLifecycle = { status: 'starting', error: null }

  it('moves from starting to ready and clears prior errors on a new start', () => {
    expect(reduceJarvisSession(starting, { type: 'ready' })).toEqual({ status: 'ready', error: null })
    expect(reduceJarvisSession({ status: 'failed', error: 'offline' }, { type: 'start' })).toEqual(starting)
  })

  it('keeps startup and runtime failures explicit until retry or recovery', () => {
    const failed = reduceJarvisSession(starting, { type: 'failed', message: 'Session API unavailable' })
    expect(failed).toEqual({ status: 'failed', error: 'Session API unavailable' })
    const runtimeError = reduceJarvisSession({ status: 'ready', error: null }, { type: 'error', message: 'Microphone denied [not-allowed]' })
    expect(runtimeError).toEqual({ status: 'error', error: 'Microphone denied [not-allowed]' })
    expect(reduceJarvisSession(runtimeError, { type: 'recover' })).toEqual({ status: 'ready', error: null })
  })
})
