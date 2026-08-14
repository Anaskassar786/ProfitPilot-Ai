import { describe, expect, it } from 'vitest'
import { createF2Bootstrap } from './f2-bootstrap.js'

describe('F2 production bootstrap', () => {
  it('does not create a data plane without F1 provider configuration', () => expect(createF2Bootstrap({})).toBeNull())
  it('fails closed on partial configuration', () => expect(() => createF2Bootstrap({ DATABASE_URL: 'postgres://db', ENCRYPTION_KEY: 'key' })).toThrow('F1 bootstrap requires'))
})
