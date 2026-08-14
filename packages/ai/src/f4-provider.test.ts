import { describe, expect, it } from 'vitest'
import { AiUnavailableError, DEFAULT_AI_MODELS, OpenRouterClient, OpenRouterError } from './provider.js'

function okResponse(text = 'Grounded explanation', usage = { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('OpenRouter fallback client', () => {
  it('uses the configured primary model and key', async () => {
    const calls: string[] = []
    const client = new OpenRouterClient({ keys: ['key-1', 'key-2', 'key-3'], models: ['primary'], fetcher: async (_url, init) => { calls.push(JSON.stringify(init.headers)); return okResponse() }, sleep: async () => undefined })
    const generation = await client.generate('system', 'user')
    expect(generation.model).toBe('primary')
    expect(generation.keyIndex).toBe(0)
    expect(generation.usage.totalTokens).toBe(7)
    expect(calls[0]).toContain('key-1')
  })
  it('defaults to all three blueprint models', () => expect(new OpenRouterClient({ keys: ['key'] }).models).toEqual([...DEFAULT_AI_MODELS]))
  it('switches models immediately on rate limits', async () => {
    const models: string[] = []
    const client = new OpenRouterClient({ keys: ['key'], models: ['primary', 'fallback'], fetcher: async (_url, init) => { const body = JSON.parse(String(init.body)) as { model: string }; models.push(body.model); return models.length === 1 ? new Response('', { status: 429 }) : okResponse() }, sleep: async () => undefined })
    await expect(client.generate('system', 'user')).resolves.toMatchObject({ model: 'fallback', attempts: 2 })
    expect(models).toEqual(['primary', 'fallback'])
  })
  it('switches on server errors', async () => {
    let calls = 0
    const client = new OpenRouterClient({ keys: ['key'], models: ['primary', 'fallback'], fetcher: async () => { calls += 1; return calls === 1 ? new Response('', { status: 503 }) : okResponse() }, sleep: async () => undefined })
    await expect(client.generate('system', 'user')).resolves.toMatchObject({ model: 'fallback' })
  })
  it('retries a network error once before succeeding', async () => {
    let calls = 0
    const client = new OpenRouterClient({ keys: ['key'], models: ['primary'], fetcher: async () => { calls += 1; if (calls === 1) throw new Error('network'); return okResponse() }, sleep: async () => undefined })
    await expect(client.generate('system', 'user')).resolves.toMatchObject({ attempts: 2 })
    expect(calls).toBe(2)
  })
  it('retries a malformed response once', async () => {
    let calls = 0
    const client = new OpenRouterClient({ keys: ['key'], models: ['primary'], fetcher: async () => { calls += 1; return calls === 1 ? new Response(JSON.stringify({ choices: [] }), { status: 200 }) : okResponse() }, sleep: async () => undefined })
    await expect(client.generate('system', 'user')).resolves.toMatchObject({ attempts: 2 })
  })
  it('rejects a choice without text and moves to the fallback', async () => {
    let calls = 0
    const client = new OpenRouterClient({ keys: ['key'], models: ['primary', 'fallback'], fetcher: async () => { calls += 1; return calls <= 2 ? new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }) : okResponse() }, sleep: async () => undefined })
    await expect(client.generate('system', 'user')).resolves.toMatchObject({ model: 'fallback' })
  })
  it('handles a valid response with no usage object', async () => {
    const client = new OpenRouterClient({ keys: ['key'], models: ['primary'], fetcher: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'No numbers here.' } }] }), { status: 200 }), sleep: async () => undefined })
    await expect(client.generate('system', 'user')).resolves.toMatchObject({ usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } })
  })
  it('rotates keys before moving to a fallback model', async () => {
    const seen: string[] = []
    const client = new OpenRouterClient({ keys: ['key-1', 'key-2', 'key-3'], models: ['primary', 'fallback'], fetcher: async (_url, init) => { seen.push(JSON.stringify(init.headers)); return seen.length < 4 ? new Response('', { status: 429 }) : okResponse() }, sleep: async () => undefined })
    await expect(client.generate('system', 'user')).resolves.toMatchObject({ model: 'fallback', keyIndex: 1 })
    expect(seen[0]).toContain('key-1')
    expect(seen[1]).toContain('key-2')
  })
  it('reports timeout as a provider failure and continues', async () => {
    let calls = 0
    const client = new OpenRouterClient({ keys: ['key'], models: ['primary', 'fallback'], fetcher: async () => { calls += 1; if (calls === 1) throw new DOMException('timeout', 'AbortError'); return okResponse() }, sleep: async () => undefined })
    await expect(client.generate('system', 'user')).resolves.toMatchObject({ model: 'fallback' })
  })
  it('fails closed when every provider candidate fails', async () => {
    const client = new OpenRouterClient({ keys: ['key-1', 'key-2'], models: ['primary'], fetcher: async () => new Response('', { status: 500 }), sleep: async () => undefined })
    await expect(client.generate('system', 'user')).rejects.toBeInstanceOf(AiUnavailableError)
  })
  it('switches after a non-rate-limit client error', async () => {
    let calls = 0
    const client = new OpenRouterClient({ keys: ['key'], models: ['primary', 'fallback'], fetcher: async () => { calls += 1; return calls === 1 ? new Response('', { status: 400 }) : okResponse() }, sleep: async () => undefined })
    await expect(client.generate('system', 'user')).resolves.toMatchObject({ model: 'fallback' })
  })
  it('rejects invalid retry configuration', () => expect(() => new OpenRouterClient({ keys: ['key'], maxRetries: -1 })).toThrow('Invalid'))
  it('rejects invalid timeout configuration', () => expect(() => new OpenRouterClient({ keys: ['key'], timeoutMs: 0 })).toThrow('Invalid'))
  it('exposes typed provider error fields', () => expect(new OpenRouterError('rate_limit', 'limited', 429).status).toBe(429))
  it('does not call a provider without configured keys', async () => {
    let calls = 0
    const client = new OpenRouterClient({ keys: [], fetcher: async () => { calls += 1; return okResponse() } })
    await expect(client.generate('system', 'user')).rejects.toBeInstanceOf(AiUnavailableError)
    expect(calls).toBe(0)
  })
})
