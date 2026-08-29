import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { MemoryIngestRepo } from './memoryRepo.js'
import { signPayload } from './signature.js'
import { WarpedClock } from '../clock.js'

const SECRET = 'whsec_route_test'

const payload = (over: Record<string, unknown> = {}, entity: Record<string, unknown> = {}) =>
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
  })

let app: FastifyInstance
let repo: MemoryIngestRepo

beforeEach(async () => {
  repo = new MemoryIngestRepo()
  repo.seedPayment({
    id: 'local_1',
    razorpayPaymentId: 'pay_known',
    amountPaise: 250000,
    failedAt: new Date('2026-09-12T08:00:00Z'),
  })
  app = await buildServer({ repo, webhookSecret: SECRET, logLevel: 'silent' })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const post = (body: string, headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/webhooks/razorpay', payload: body, headers: { 'content-type': 'application/json', ...headers } })

describe('POST /webhooks/razorpay', () => {
  it('accepts a correctly signed event end to end', async () => {
    const body = payload()
    const res = await post(body, {
      'x-razorpay-signature': signPayload(Buffer.from(body), SECRET),
      'x-razorpay-event-id': 'evt_ok',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'processed' })
    expect(repo.outcomes).toHaveLength(1)
  })

  it('returns 401 and stores nothing for a bad signature', async () => {
    const body = payload()
    const res = await post(body, {
      'x-razorpay-signature': signPayload(Buffer.from(body), 'wrong_secret'),
      'x-razorpay-event-id': 'evt_bad_sig',
    })

    expect(res.statusCode).toBe(401)
    expect(repo.events.size).toBe(0)
    expect(repo.outcomes).toHaveLength(0)
  })

  it('returns 401 when the signature header is absent', async () => {
    const res = await post(payload(), { 'x-razorpay-event-id': 'evt_no_sig' })
    expect(res.statusCode).toBe(401)
    expect(repo.events.size).toBe(0)
  })

  it('rejects a body tampered with after signing', async () => {
    const original = payload()
    const signature = signPayload(Buffer.from(original), SECRET)
    const tampered = original.replace('250000', '999999')

    const res = await post(tampered, {
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': 'evt_tampered',
    })

    expect(res.statusCode).toBe(401)
    expect(repo.outcomes).toHaveLength(0)
  })

  it('verifies against raw bytes, so byte-identical resend still works', async () => {
    const body = payload()
    const sig = signPayload(Buffer.from(body), SECRET)
    const first = await post(body, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'e1' })
    const second = await post(body, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'e2' })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
  })

  it('verifies a pretty-printed body that reserialisation would not reproduce', async () => {
    const obj = JSON.parse(payload()) as unknown
    const pretty = JSON.stringify(obj, null, 2)
    expect(pretty).not.toBe(JSON.stringify(obj))

    const res = await post(pretty, {
      'x-razorpay-signature': signPayload(Buffer.from(pretty), SECRET),
      'x-razorpay-event-id': 'evt_pretty',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'processed' })
  })

  it('verifies a body carrying a unicode escape that reserialisation would decode', async () => {
    const body = payload({}, { error_description: 'Insufficient balance RS250' }).replace(
      'RS',
      String.raw`\u20b9`,
    )
    expect(body).toContain(String.raw`\u20b9`)
    expect(body).not.toBe(JSON.stringify(JSON.parse(body)))

    const res = await post(body, {
      'x-razorpay-signature': signPayload(Buffer.from(body), SECRET),
      'x-razorpay-event-id': 'evt_unicode',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'processed' })
  })

  it('acknowledges an unknown payment with 200 and marks it unmatched', async () => {
    const body = payload({}, { id: 'pay_from_someone_elses_test_account' })
    const res = await post(body, {
      'x-razorpay-signature': signPayload(Buffer.from(body), SECRET),
      'x-razorpay-event-id': 'evt_unknown',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'unmatched' })
    expect(repo.events.get('evt_unknown')!.status).toBe('unmatched')
  })

  it('dedupes a replayed delivery of the same event id', async () => {
    const body = payload()
    const headers = {
      'x-razorpay-signature': signPayload(Buffer.from(body), SECRET),
      'x-razorpay-event-id': 'evt_replay',
    }

    const first = await post(body, headers)
    const second = await post(body, headers)

    expect(first.json()).toEqual({ status: 'processed' })
    expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual({ status: 'duplicate' })
    expect(repo.outcomes).toHaveLength(1)
  })

  it('acknowledges malformed JSON that carries a valid signature', async () => {
    const body = '{ not json'
    const res = await post(body, {
      'x-razorpay-signature': signPayload(Buffer.from(body), SECRET),
      'x-razorpay-event-id': 'evt_malformed',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'invalid' })
  })

  it('falls back to a body hash when the event id header is missing', async () => {
    const body = payload()
    const sig = signPayload(Buffer.from(body), SECRET)

    const first = await post(body, { 'x-razorpay-signature': sig })
    const second = await post(body, { 'x-razorpay-signature': sig })

    expect(first.json()).toEqual({ status: 'processed' })
    expect(second.json()).toEqual({ status: 'duplicate' })
  })

  it('leaves the health route on the normal JSON parser', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.json()).toEqual({ status: 'ok', clock: 'real time' })
  })

  it('announces a warped clock on the health route', async () => {
    const warped = await buildServer({
      repo,
      webhookSecret: SECRET,
      logLevel: 'silent',
      clock: new WarpedClock(new Date('2026-07-14T00:00:00Z'), 3600, () => 0),
    })
    await warped.ready()
    const res = await warped.inject({ method: 'GET', url: '/health' })
    expect(res.json().clock).toBe('warped x3600 from 2026-07-14T00:00:00.000Z')
    await warped.close()
  })
})
