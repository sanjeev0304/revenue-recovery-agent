import { describe, expect, it } from 'vitest'
import type { ChargeAck, ChargeOutcome, ChargeOutcomeAdapter, ChargeRequest } from '@revenue/core'
import { RazorpayAdapter } from './razorpay.js'
import { SimulatedAdapter } from './simulated.js'

const FAILED_AT = new Date('2026-09-10T00:00:00Z')
const HOUR = 3_600_000

const request = (over: Partial<ChargeRequest> = {}): ChargeRequest => ({
  paymentId: over.paymentId ?? 'pay_1',
  idempotencyKey: over.idempotencyKey ?? 'pay_1:0:retry_charge',
  amountPaise: over.amountPaise ?? 250_000,
  method: over.method ?? 'upi',
  attemptedAt: over.attemptedAt ?? new Date(FAILED_AT.getTime() + 30 * HOUR),
})

function simulated(succeedsAfterMs: number | null, outcomes: ChargeOutcome[] = []) {
  return new SimulatedAdapter({
    loadOracle: async () => ({
      failedAt: FAILED_AT,
      oracle: {
        retry_charge:
          succeedsAfterMs === null
            ? { succeeds: false, afterMs: null }
            : { succeeds: true, afterMs: succeedsAfterMs },
        issue_payment_link: { succeeds: false, afterMs: null },
        send_nudge: { succeeds: false, afterMs: null },
      },
    }),
    onOutcome: async (o) => {
      outcomes.push(o)
    },
  })
}

function razorpayReturning(status: number, payload: unknown) {
  return new RazorpayAdapter({
    keyId: 'rzp_test_fake',
    keySecret: 'secret',
    fetchImpl: (async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  })
}

const ackShape = (ack: ChargeAck): string[] => Object.keys(ack).sort()

describe('both adapters satisfy the same interface', () => {
  it('are assignable to ChargeOutcomeAdapter', () => {
    const adapters: ChargeOutcomeAdapter[] = [
      razorpayReturning(200, { id: 'order_1' }),
      simulated(24 * HOUR),
    ]
    expect(adapters.map((a) => a.kind).sort()).toEqual(['razorpay', 'simulated'])
  })

  it('return structurally identical acks on success', async () => {
    const rzp = await razorpayReturning(200, { id: 'order_1' }).attemptCharge(request())
    const sim = await simulated(24 * HOUR).attemptCharge(request())

    expect(ackShape(rzp)).toEqual(['accepted', 'attemptedAt', 'providerRef'])
    expect(ackShape(sim)).toEqual(ackShape(rzp))
    expect(rzp.accepted).toBe(true)
    expect(sim.accepted).toBe(true)
  })

  it('return structurally identical acks on rejection', async () => {
    const rzp = await razorpayReturning(400, { error: 'bad' }).attemptCharge(request())
    const sim = await new SimulatedAdapter({
      loadOracle: async () => null,
      onOutcome: async () => {},
    }).attemptCharge(request())

    expect(ackShape(rzp)).toEqual(['accepted', 'attemptedAt', 'rejection'])
    expect(ackShape(sim)).toEqual(ackShape(rzp))
    expect(rzp.accepted).toBe(false)
    expect(sim.accepted).toBe(false)
  })

  it('neither adapter can return an outcome from attemptCharge', async () => {
    const rzp = await razorpayReturning(200, { id: 'order_1' }).attemptCharge(request())
    const sim = await simulated(24 * HOUR).attemptCharge(request())
    for (const ack of [rzp, sim]) {
      expect(ack).not.toHaveProperty('status')
      expect(ack).not.toHaveProperty('outcome')
    }
  })

  it('echo the attemptedAt they were given rather than reading a clock', async () => {
    const at = new Date('2026-01-01T00:00:00Z')
    const rzp = await razorpayReturning(200, { id: 'o' }).attemptCharge(request({ attemptedAt: at }))
    const sim = await simulated(0).attemptCharge(request({ attemptedAt: at }))
    expect(rzp.attemptedAt).toEqual(at)
    expect(sim.attemptedAt).toEqual(at)
  })
})

describe('SimulatedAdapter consults the oracle', () => {
  it('succeeds only once the oracle delay has elapsed', async () => {
    const early: ChargeOutcome[] = []
    await simulated(24 * HOUR, early).attemptCharge(
      request({ attemptedAt: new Date(FAILED_AT.getTime() + 23 * HOUR) }),
    )
    expect(early[0]!.status).toBe('failed')

    const late: ChargeOutcome[] = []
    await simulated(24 * HOUR, late).attemptCharge(
      request({ attemptedAt: new Date(FAILED_AT.getTime() + 24 * HOUR) }),
    )
    expect(late[0]!.status).toBe('succeeded')
  })

  it('never succeeds when the oracle says the intervention cannot work', async () => {
    const outcomes: ChargeOutcome[] = []
    await simulated(null, outcomes).attemptCharge(
      request({ attemptedAt: new Date(FAILED_AT.getTime() + 10_000 * HOUR) }),
    )
    expect(outcomes[0]!.status).toBe('failed')
  })

  it('tags its outcome as simulated for the audit trail', async () => {
    const outcomes: ChargeOutcome[] = []
    await simulated(0, outcomes).attemptCharge(request())
    expect(outcomes[0]!.source).toBe('simulated')
  })

  it('emits no outcome when the payment is unknown', async () => {
    const outcomes: ChargeOutcome[] = []
    await new SimulatedAdapter({
      loadOracle: async () => null,
      onOutcome: async (o) => {
        outcomes.push(o)
      },
    }).attemptCharge(request())
    expect(outcomes).toHaveLength(0)
  })
})

describe('RazorpayAdapter refuses live mode', () => {
  it('throws on a key id that is not rzp_test_ prefixed', () => {
    expect(() => new RazorpayAdapter({ keyId: 'rzp_live_x', keySecret: 's' })).toThrow(
      /rzp_test_/,
    )
  })

  it('rejects a malformed order response instead of inventing a ref', async () => {
    const ack = await razorpayReturning(200, { nope: true }).attemptCharge(request())
    expect(ack.accepted).toBe(false)
    if (!ack.accepted) expect(ack.rejection.code).toBe('malformed_response')
  })

  it('passes the idempotency key to the API', async () => {
    let seen: string | null = null
    const adapter = new RazorpayAdapter({
      keyId: 'rzp_test_fake',
      keySecret: 's',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen = (init.headers as Record<string, string>)['x-razorpay-idempotency-key'] ?? null
        return new Response(JSON.stringify({ id: 'order_1' }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    await adapter.attemptCharge(request({ idempotencyKey: 'pay_9:2:retry_charge' }))
    expect(seen).toBe('pay_9:2:retry_charge')
  })
})
