import { describe, expect, it } from 'vitest'
// ShopifyBulkClient is intentionally not exported from the package index
// (no production callers yet) — import the implementation directly.
import { ShopifyBulkClient } from './bulk.js'
import { ShopifyClient } from './index.js'

describe('Shopify GraphQL bulk operations', () => {
  it('starts, polls, and downloads a completed JSONL operation', async () => {
    let requests = 0
    const transport = async (_url: string, init: RequestInit): Promise<Response> => {
      requests += 1
      const body = JSON.parse(String(init.body)) as { query: string }
      if (body.query.startsWith('mutation')) return new Response(JSON.stringify({ data: { bulkOperationRunQuery: { bulkOperation: { id: 'gid://bulk/1', status: 'CREATED' }, userErrors: [] } } }), { status: 200 })
      return new Response(JSON.stringify({ data: { currentBulkOperation: { id: 'gid://bulk/1', status: 'COMPLETED', url: 'https://download.example/result.jsonl', errorCode: null } } }), { status: 200 })
    }
    const fetcher = async (url: string): Promise<Response> => {
      expect(url).toContain('download.example')
      return new Response('{"id":1}\n', { status: 200 })
    }
    const bulk = new ShopifyBulkClient(new ShopifyClient('demo.myshopify.com', 'token', transport), { fetcher, sleep: async () => undefined })
    const result = await bulk.runQuery('{ products { edges { node { id } } } }')
    expect(result.jsonl).toContain('"id":1')
    expect(requests).toBe(2)
  })
  it('surfaces GraphQL user errors', async () => {
    const transport = async (): Promise<Response> => new Response(JSON.stringify({ data: { bulkOperationRunQuery: { bulkOperation: null, userErrors: [{ message: 'invalid query' }] } } }), { status: 200 })
    await expect(new ShopifyBulkClient(new ShopifyClient('demo.myshopify.com', 'token', transport), { sleep: async () => undefined }).runQuery('query')).rejects.toThrow('invalid query')
  })
  it('surfaces terminal bulk operation errors', async () => {
    let first = true
    const transport = async (): Promise<Response> => {
      if (first) { first = false; return new Response(JSON.stringify({ data: { bulkOperationRunQuery: { bulkOperation: { id: 'id', status: 'CREATED' }, userErrors: [] } } }), { status: 200 }) }
      return new Response(JSON.stringify({ data: { currentBulkOperation: { id: 'id', status: 'FAILED', url: null, errorCode: 'INTERNAL_SERVER_ERROR' } } }), { status: 200 })
    }
    await expect(new ShopifyBulkClient(new ShopifyClient('demo.myshopify.com', 'token', transport), { sleep: async () => undefined }).runQuery('query')).rejects.toThrow('INTERNAL_SERVER_ERROR')
  })
  it('times out a never-ending operation', async () => {
    let first = true
    const transport = async (): Promise<Response> => {
      if (first) { first = false; return new Response(JSON.stringify({ data: { bulkOperationRunQuery: { bulkOperation: { id: 'id', status: 'CREATED' }, userErrors: [] } } }), { status: 200 }) }
      return new Response(JSON.stringify({ data: { currentBulkOperation: { id: 'id', status: 'RUNNING', url: null, errorCode: null } } }), { status: 200 })
    }
    await expect(new ShopifyBulkClient(new ShopifyClient('demo.myshopify.com', 'token', transport), { maxPolls: 2, sleep: async () => undefined }).runQuery('query')).rejects.toThrow('timed out')
  })
  it('rejects an empty bulk query', async () => {
    const transport = async (): Promise<Response> => new Response('{}', { status: 200 })
    await expect(new ShopifyBulkClient(new ShopifyClient('demo.myshopify.com', 'token', transport), { sleep: async () => undefined }).runQuery(' ')).rejects.toThrow('cannot be empty')
  })
  it('surfaces GraphQL top-level errors', async () => {
    const transport = async (): Promise<Response> => new Response(JSON.stringify({ errors: [{ message: 'GraphQL unavailable' }] }), { status: 200 })
    await expect(new ShopifyBulkClient(new ShopifyClient('demo.myshopify.com', 'token', transport), { sleep: async () => undefined }).runQuery('query')).rejects.toThrow('GraphQL unavailable')
  })
})
