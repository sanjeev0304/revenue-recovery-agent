import { describe, expect, it } from 'vitest'
import { GeminiProvider } from './gemini.js'

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
  })

describe('GeminiProvider', () => {
  it('extracts the text part', async () => {
    const p = new GeminiProvider({
      apiKey: 'k',
      fetchImpl: (async () => ok('{"a":1}')) as unknown as typeof fetch,
    })
    expect(await p.complete('hi')).toBe('{"a":1}')
    expect(p.calls).toBe(1)
  })

  it('reports truncation explicitly instead of as bad JSON', async () => {
    const p = new GeminiProvider({
      apiKey: 'k',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }),
          { status: 200 },
        )) as unknown as typeof fetch,
    })
    await expect(p.complete('hi')).rejects.toThrow(/truncated/)
  })

  it('surfaces an http error with its status', async () => {
    const p = new GeminiProvider({
      apiKey: 'k',
      fetchImpl: (async () => new Response('quota', { status: 429 })) as unknown as typeof fetch,
    })
    await expect(p.complete('hi')).rejects.toThrow(/429/)
  })

  it('rejects an empty api key', () => {
    expect(() => new GeminiProvider({ apiKey: '' })).toThrow(/GEMINI_API_KEY/)
  })

  it('disables thinking so the token budget reaches the answer', async () => {
    let body: string | null = null
    const p = new GeminiProvider({
      apiKey: 'k',
      fetchImpl: (async (_u: string, init: RequestInit) => {
        body = init.body as string
        return ok('{}')
      }) as unknown as typeof fetch,
    })
    await p.complete('hi')
    const parsed = JSON.parse(body!) as { generationConfig: Record<string, unknown> }
    expect(parsed.generationConfig['thinkingConfig']).toEqual({ thinkingBudget: 0 })
    expect(parsed.generationConfig['temperature']).toBe(0)
  })
})
