import type { LLMProvider } from '@revenue/core'

export interface GeminiConfig {
  apiKey: string
  model?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class GeminiProvider implements LLMProvider {
  readonly model: string

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  calls = 0

  constructor(config: GeminiConfig) {
    if (config.apiKey.length === 0) throw new Error('GEMINI_API_KEY is empty')
    this.apiKey = config.apiKey
    this.model = config.model ?? 'gemini-2.5-flash'
    this.baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
    this.fetchImpl = config.fetchImpl ?? fetch
    this.timeoutMs = config.timeoutMs ?? 20_000
  }

  async complete(prompt: string): Promise<string> {
    this.calls++

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/models/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: controller.signal,
        },
      )

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`gemini http ${response.status}: ${detail.slice(0, 200)}`)
      }

      const body = (await response.json()) as {
        candidates?: Array<{
          finishReason?: unknown
          content?: { parts?: Array<{ text?: unknown }> }
        }>
      }

      const candidate = body.candidates?.[0]
      const finishReason = candidate?.finishReason

      if (finishReason === 'MAX_TOKENS') {
        throw new Error(
          'gemini truncated the response at maxOutputTokens; raise the budget or disable thinking',
        )
      }

      const text = candidate?.content?.parts?.[0]?.text
      if (typeof text !== 'string') {
        throw new Error(`gemini response had no text part (finishReason=${String(finishReason)})`)
      }
      return text
    } finally {
      clearTimeout(timer)
    }
  }
}
