import { describe, expect, it } from 'vitest'
import { MemoryIngestRepo } from './memoryRepo.js'
import { processWebhookEvent } from './processEvent.js'

const RECEIVED_AT = new Date('2026-09-12T10:00:00Z')

function body(over: Record<string, unknown> = {}, entity: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      entity: 'event',
      event: 'payment.failed',
      created_at: 1789000000,
      payload: {
        payment: {
          entity: {
            id: 'pay_known',
            order_id: 'order_1',
            amount: 250000,
            currency: 'INR',
            status: 'failed',
            method: 'upi',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Insufficient balance',
            error_source: 'bank',
            error_step: 'payment_authorization',
            error_reason: 'insufficient_funds',
            ...entity,
          },
        },
      },
      ...over,
    }),
  )
}

function repoWithKnownPayment(): MemoryIngestRepo {
  const repo = new MemoryIngestRepo()
  repo.seedPayment({
    id: 'local_1',
    razorpayPaymentId: 'pay_known',
    amountPaise: 250000,
    failedAt: new Date('2026-09-12T08:00:00Z'),
  })
  return repo
}

const run = (repo: MemoryIngestRepo, raw: Buffer, eventId: string) =>
  processWebhookEvent(repo, {
    eventId,
    rawBody: raw,
    signatureVerified: true,
    receivedAt: RECEIVED_AT,
  })

describe('known payment', () => {
  it('records a payment.failed outcome with the raw razorpay fields preserved', async () => {
    const repo = repoWithKnownPayment()
    const result = await run(repo, body(), 'evt_1')

    expect(result).toMatchObject({ httpStatus: 200, status: 'processed' })
    expect(repo.outcomes).toHaveLength(1)

    const recorded = repo.outcomes[0]!.outcome
    expect(recorded.status).toBe('failed')
    expect(recorded.source).toBe('razorpay')
    if (recorded.status === 'failed') {
      expect(recorded.failure.reason).toBe('insufficient_funds')
      expect(recorded.failure.source).toBe('bank')
      expect(recorded.failure.step).toBe('payment_authorization')
      expect(recorded.failure.code).toBe('BAD_REQUEST_ERROR')
    }
  })

  it('records payment.captured as succeeded', async () => {
    const repo = repoWithKnownPayment()
    const result = await run(repo, body({ event: 'payment.captured' }), 'evt_2')

    expect(result.status).toBe('processed')
    expect(repo.outcomes[0]!.outcome.status).toBe('succeeded')
  })
})

describe('unknown payment', () => {
  it('acknowledges with 200 and marks unmatched rather than throwing', async () => {
    const repo = new MemoryIngestRepo()
    const result = await run(repo, body({}, { id: 'pay_never_seen' }), 'evt_3')

    expect(result.httpStatus).toBe(200)
    expect(result.status).toBe('unmatched')
    expect(repo.events.get('evt_3')!.status).toBe('unmatched')
  })

  it('still persists the raw event so it is never lost', async () => {
    const repo = new MemoryIngestRepo()
    await run(repo, body({}, { id: 'pay_never_seen' }), 'evt_4')

    const stored = repo.events.get('evt_4')!
    expect(stored.rawBody).toContain('pay_never_seen')
    expect(stored.signatureVerified).toBe(true)
  })

  it('records no charge outcome for an unmatched payment', async () => {
    const repo = new MemoryIngestRepo()
    await run(repo, body({}, { id: 'pay_never_seen' }), 'evt_5')
    expect(repo.outcomes).toHaveLength(0)
  })
})

describe('dedupe', () => {
  it('rejects a replayed event id and does not double-record the outcome', async () => {
    const repo = repoWithKnownPayment()

    const first = await run(repo, body(), 'evt_replay')
    const second = await run(repo, body(), 'evt_replay')

    expect(first.status).toBe('processed')
    expect(second).toMatchObject({ httpStatus: 200, status: 'duplicate' })
    expect(repo.outcomes).toHaveLength(1)
  })

  it('dedupes on the event id even when the body differs', async () => {
    const repo = repoWithKnownPayment()
    await run(repo, body(), 'evt_same')
    const second = await run(repo, body({ event: 'payment.captured' }), 'evt_same')

    expect(second.status).toBe('duplicate')
    expect(repo.outcomes).toHaveLength(1)
    expect(repo.outcomes[0]!.outcome.status).toBe('failed')
  })

  it('treats a genuinely different event id as new', async () => {
    const repo = repoWithKnownPayment()
    await run(repo, body(), 'evt_a')
    const second = await run(repo, body(), 'evt_b')
    expect(second.status).toBe('processed')
    expect(repo.outcomes).toHaveLength(2)
  })
})

describe('malformed and unhandled input', () => {
  it('acknowledges unparseable JSON as invalid, not as a delivery failure', async () => {
    const repo = new MemoryIngestRepo()
    const result = await run(repo, Buffer.from('{not json'), 'evt_bad')

    expect(result.httpStatus).toBe(200)
    expect(result.status).toBe('invalid')
    expect(repo.events.get('evt_bad')!.rawBody).toBe('{not json')
  })

  it('acknowledges a payload that fails schema validation', async () => {
    const repo = new MemoryIngestRepo()
    const result = await run(repo, Buffer.from(JSON.stringify({ event: 'payment.failed' })), 'evt_x')

    expect(result.httpStatus).toBe(200)
    expect(result.status).toBe('invalid')
    expect(result.note).toContain('payload')
  })

  it('ignores an event type it does not handle', async () => {
    const repo = repoWithKnownPayment()
    const result = await run(repo, body({ event: 'refund.created' }), 'evt_refund')

    expect(result.httpStatus).toBe(200)
    expect(result.status).toBe('ignored')
    expect(repo.outcomes).toHaveLength(0)
  })

  it('never returns 500 for any well-persisted event', async () => {
    const repo = repoWithKnownPayment()
    const cases: Array<[string, Buffer]> = [
      ['c1', body()],
      ['c2', body({ event: 'refund.created' })],
      ['c3', body({}, { id: 'pay_unknown' })],
      ['c4', Buffer.from('{{{')],
      ['c5', Buffer.from('{}')],
    ]
    for (const [id, raw] of cases) {
      expect((await run(repo, raw, id)).httpStatus).toBe(200)
    }
  })
})
