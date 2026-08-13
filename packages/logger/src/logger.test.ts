import { describe, expect, it } from 'vitest'
import { Logger, createMemorySink, mergeFields, redactFields } from './index.js'

describe('structured logger', () => {
  it('emits records above the configured level', () => {
    const memory = createMemorySink()
    const logger = new Logger(memory.sink, 'info')
    logger.debug('hidden')
    logger.info('visible', { storeId: 'store-1' })
    logger.error('broken')
    expect(memory.records).toHaveLength(2)
    expect(memory.records[0]?.message).toBe('visible')
    expect(memory.records[1]?.level).toBe('error')
  })
  it('emits debug records when configured', () => {
    const memory = createMemorySink()
    new Logger(memory.sink, 'debug').debug('visible')
    expect(memory.records[0]?.level).toBe('debug')
  })
  it('creates a child logger with inherited context', () => {
    const memory = createMemorySink()
    const child = new Logger(memory.sink, 'info', { service: 'api' }).child({ requestId: 'req-1' })
    child.info('request')
    expect(memory.records[0]?.context).toMatchObject({ service: 'api', requestId: 'req-1' })
  })
  it('redacts secret-like keys', () => {
    const fields = redactFields({ token: 'secret', password: 'pw', safe: 'ok', nested: { email: 'merchant@example.com' } })
    expect(fields).toEqual({ token: '[REDACTED]', password: '[REDACTED]', safe: 'ok', nested: { email: '[REDACTED]' } })
  })
  it('redacts arrays without changing safe values', () => {
    const fields = redactFields({ values: [{ safe: 'yes' }, { apiKey: 'secret' }] })
    expect(fields).toEqual({ values: [{ safe: 'yes' }, { apiKey: '[REDACTED]' }] })
  })
  it('merges context with later fields', () => {
    expect(mergeFields({ version: 1, state: 'old' }, { state: 'new' })).toEqual({ version: 1, state: 'new' })
  })
  it('keeps null JSON fields', () => {
    expect(redactFields({ value: null })).toEqual({ value: null })
  })
  it('does not log a debug message at info level', () => {
    const memory = createMemorySink()
    new Logger(memory.sink, 'warn').info('not emitted')
    expect(memory.records).toHaveLength(0)
  })
  it('keeps timestamps ISO formatted', () => {
    const memory = createMemorySink()
    new Logger(memory.sink).info('time')
    expect(memory.records[0]?.timestamp).toMatch(/T/)
  })
})
