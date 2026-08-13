import { describe, expect, it } from 'vitest'
import { createF5Bootstrap } from './f5-bootstrap.js'

describe('F5 bootstrap', () => {
  it('fails closed without F1 and F4 provider configuration', () => expect(createF5Bootstrap({})).toBeNull())
  it('does not silently accept partial provider configuration', () => expect(() => createF5Bootstrap({ DATABASE_URL: 'postgres://db' })).toThrow('F1 bootstrap requires'))
})
