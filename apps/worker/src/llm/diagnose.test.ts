import { describe, expect, it } from 'vitest'
import type { LLMProvider, PaymentFacts } from '@revenue/core'
import { createDiagnoser } from './diagnose.js'

function facts(over: Partial<PaymentFacts> & { reason?: string | null } = {}): PaymentFacts {
  return {
    paymentId: over.paymentId ?? 'pay_1',
    customerId: 'cust_1',
    amountPaise: over.amountPaise ?? 250_000,
    method: over.method ?? 'upi',
    failure: {
      code: 'BAD_REQUEST_ERROR',
      description: null,
      source: 'bank',
      step: 'payment_authorization',
      reason: over.reason === undefined ? 'payment_failed' : over.reason,
    },
    failedAt: over.failedAt ?? new Date('2026-08-01T10:00:00Z'),
    attemptNumber: over.attemptNumber ?? 1,
  }
}

function provider(responses: string[]): LLMProvider & { calls: number } {
  let i = 0
  return {
    model: 'fake',
    calls: 0,
    async complete(): Promise<string> {
      ;(this as { calls: number }).calls++
      return responses[Math.min(i++, responses.length - 1)]!
    },
  }
}

const good = JSON.stringify({
  rootCause: 'INSUFFICIENT_FUNDS',
  confidence: 0.82,
  reasoning: 'large amount, pre-payday',
})

describe('deterministic path', () => {
  it('never calls the model for a mapped reason', async () => {
    const p = provider([good])
    const { diagnose, stats } = createDiagnoser({ provider: p })

    const d = await diagnose(facts({ reason: 'insufficient_funds' }))

    expect(d.classifier).toBe('deterministic')
    expect(d.rootCause).toBe('INSUFFICIENT_FUNDS')
    expect(p.calls).toBe(0)
    expect(stats.apiCalls).toBe(0)
    expect(stats.deterministic).toBe(1)
  })

  it('never calls the model for a risk decline', async () => {
    const p = provider([good])
    const { diagnose } = createDiagnoser({ provider: p })
    const d = await diagnose(facts({ reason: 'payment_risk_check_failed' }))
    expect(d.rootCause).toBe('RISK_DECLINE')
    expect(p.calls).toBe(0)
  })
})

describe('caching by error signature', () => {
  it('calls once for many records sharing a signature', async () => {
    const p = provider([good])
    const { diagnose, stats } = createDiagnoser({ provider: p })

    for (let i = 0; i < 25; i++) {
      await diagnose(facts({ paymentId: `pay_${i}`, amountPaise: 1000 * i }))
    }

    expect(p.calls).toBe(1)
    expect(stats.apiCalls).toBe(1)
    expect(stats.cacheHits).toBe(24)
    expect(stats.llmResolved).toBe(25)
  })

  it('calls again for a different signature', async () => {
    const p = provider([good])
    const { diagnose, stats } = createDiagnoser({ provider: p })

    await diagnose(facts({ reason: 'payment_failed', method: 'upi' }))
    await diagnose(facts({ reason: 'card_declined', method: 'card' }))

    expect(stats.apiCalls).toBe(2)
  })

  it('caches the failure too, so a broken signature is not retried per record', async () => {
    const p = provider(['not json at all'])
    const { diagnose, stats } = createDiagnoser({ provider: p })

    await diagnose(facts({ paymentId: 'a' }))
    await diagnose(facts({ paymentId: 'b' }))

    expect(stats.apiCalls).toBe(1)
    expect(stats.parseFailures).toBe(1)
  })
})

describe('failure handling', () => {
  it('degrades to the provisional cause when the model returns junk', async () => {
    const { diagnose, stats } = createDiagnoser({ provider: provider(['<html>oops</html>']) })
    const d = await diagnose(facts())

    expect(stats.parseFailures).toBe(1)
    expect(d.rootCause).toBe('OPAQUE_BANK_DECLINE')
    expect(d.confidence).toBe(0)
  })

  it('degrades when the model throws', async () => {
    const throwing: LLMProvider = {
      model: 'fake',
      async complete(): Promise<string> {
        throw new Error('429 quota exceeded')
      },
    }
    const { diagnose, stats } = createDiagnoser({ provider: throwing })
    const d = await diagnose(facts())

    expect(stats.parseFailures).toBe(1)
    expect(d.confidence).toBe(0)
    expect(d.evidence.join(' ')).toContain('quota exceeded')
  })

  it('rejects a confidence outside 0..1 rather than trusting it', async () => {
    const bad = JSON.stringify({ rootCause: 'AUTH_FAILED', confidence: 4, reasoning: 'x' })
    const { diagnose, stats } = createDiagnoser({ provider: provider([bad]) })
    const d = await diagnose(facts())

    expect(stats.parseFailures).toBe(1)
    expect(d.rootCause).toBe('OPAQUE_BANK_DECLINE')
  })

  it('rejects a rootCause outside the taxonomy', async () => {
    const bad = JSON.stringify({ rootCause: 'MADE_UP', confidence: 0.9, reasoning: 'x' })
    const { diagnose, stats } = createDiagnoser({ provider: provider([bad]) })
    await diagnose(facts())
    expect(stats.parseFailures).toBe(1)
  })

  it('holds the provisional cause without a provider at all', async () => {
    const { diagnose, stats } = createDiagnoser({ provider: null })
    const d = await diagnose(facts())
    expect(d.rootCause).toBe('OPAQUE_BANK_DECLINE')
    expect(d.confidence).toBe(0)
    expect(stats.apiCalls).toBe(0)
  })
})
