import { describe, expect, it } from 'vitest'
import { createF4Bootstrap } from './f4-bootstrap.js'

describe('F4 provider bootstrap', () => {
  it('does not construct AI or database clients without F1 config', () => expect(createF4Bootstrap({})).toBeNull())
  it('fails closed on partial F1 config', () => expect(() => createF4Bootstrap({ DATABASE_URL: 'postgres://db' })).toThrow('F1 bootstrap requires'))
})
