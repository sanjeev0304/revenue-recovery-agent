import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@revenue/db'
import { PrismaIngestRepo } from './prismaRepo.js'
import { processWebhookEvent } from './processEvent.js'

const PREFIX = 'itest_'
const repo = new PrismaIngestRepo()

const body = (id: string, event = 'payment.failed') =>
  Buffer.from(
    JSON.stringify({
      entity: 'event',
      event,
      created_at: 1789000000,
      payload: {
        payment: {
          entity: {
            id,
            order_id: `${PREFIX}order`,
            amount: 250000,
            currency: 'INR',
            status: 'failed',
            method: 'upi',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Insufficient balance',
            error_source: 'bank',
            error_step: 'payment_authorization',
            error_reason: 'insufficient_funds',
          },
        },
      },
    }),
  )

async function cleanup(): Promise<void> {
  await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: PREFIX } } })
  const payments = await prisma.paymentAttempt.findMany({
    where: { razorpayPaymentId: { startsWith: PREFIX } },
    select: { id: true },
  })
  const ids = payments.map((p) => p.id)
  await prisma.auditLog.deleteMany({ where: { paymentAttemptId: { in: ids } } })
  await prisma.action.deleteMany({ where: { paymentAttemptId: { in: ids } } })
  await prisma.paymentAttempt.deleteMany({ where: { id: { in: ids } } })
  await prisma.customer.deleteMany({ where: { externalId: { startsWith: PREFIX } } })
}

beforeAll(cleanup)
afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

describe('PrismaIngestRepo against the real database', () => {
  it('rejects a replayed event id at the database, not in application code', async () => {
    const eventId = `${PREFIX}evt_dupe`

    const first = await repo.storeEvent({
      eventId,
      event: 'payment.failed',
      rawBody: '{}',
      signatureVerified: true,
      payload: {},
      receivedAt: new Date(),
    })
    const second = await repo.storeEvent({
      eventId,
      event: 'payment.failed',
      rawBody: '{"different":"body"}',
      signatureVerified: true,
      payload: { different: 'body' },
      receivedAt: new Date(),
    })

    expect(first).toBe('stored')
    expect(second).toBe('duplicate')

    const rows = await prisma.webhookEvent.findMany({ where: { eventId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.rawBody).toBe('{}')
  })

  it('raises P2002 on a raw duplicate insert, proving the constraint is enforced by Postgres', async () => {
    const eventId = `${PREFIX}evt_raw`
    const data = {
      eventId,
      event: 'payment.failed',
      rawBody: '{}',
      signatureVerified: true,
      receivedAt: new Date(),
    }
    await prisma.webhookEvent.create({ data })

    let code: string | null = null
    try {
      await prisma.webhookEvent.create({ data })
    } catch (err) {
      code = (err as { code?: string }).code ?? null
    }
    expect(code).toBe('P2002')
  })

  it('ingests a payment and records an audit row', async () => {
    const payment = await repo.ingestFailedPayment({
      razorpayPaymentId: `${PREFIX}pay_1`,
      razorpayOrderId: `${PREFIX}order_1`,
      customerExternalId: `${PREFIX}cust_1`,
      amountPaise: 250000,
      method: 'upi',
      failure: {
        code: 'BAD_REQUEST_ERROR',
        description: 'Insufficient balance',
        source: 'bank',
        step: 'payment_authorization',
        reason: 'insufficient_funds',
      },
      failedAt: new Date('2026-08-20T10:00:00Z'),
      attemptNumber: 1,
      isSynthetic: true,
      syntheticTrueCause: 'INSUFFICIENT_FUNDS',
      recoverableUnder: {
        retry_charge: { succeeds: true, afterMs: 86400000 },
        issue_payment_link: { succeeds: false, afterMs: null },
        send_nudge: { succeeds: false, afterMs: null },
      },
      evalSplit: 'train',
      datasetVersion: 'itest',
    })

    expect(payment.razorpayPaymentId).toBe(`${PREFIX}pay_1`)

    const audits = await prisma.auditLog.findMany({ where: { paymentAttemptId: payment.id } })
    expect(audits.map((a) => a.event)).toContain('ingested')
  })

  it('is idempotent on re-ingest of the same payment id', async () => {
    const input = {
      razorpayPaymentId: `${PREFIX}pay_2`,
      razorpayOrderId: null,
      customerExternalId: `${PREFIX}cust_1`,
      amountPaise: 100000,
      method: 'card' as const,
      failure: {
        code: null,
        description: null,
        source: 'bank',
        step: 'payment_authorization',
        reason: 'card_declined',
      },
      failedAt: new Date('2026-08-21T10:00:00Z'),
      attemptNumber: 1,
      isSynthetic: true,
    }
    const a = await repo.ingestFailedPayment(input)
    const b = await repo.ingestFailedPayment(input)
    expect(a.id).toBe(b.id)

    const count = await prisma.paymentAttempt.count({
      where: { razorpayPaymentId: `${PREFIX}pay_2` },
    })
    expect(count).toBe(1)
  })

  it('runs a full webhook event through to a recorded outcome', async () => {
    const paymentId = `${PREFIX}pay_3`
    await repo.ingestFailedPayment({
      razorpayPaymentId: paymentId,
      razorpayOrderId: null,
      customerExternalId: `${PREFIX}cust_2`,
      amountPaise: 500000,
      method: 'upi',
      failure: {
        code: null,
        description: null,
        source: 'bank',
        step: 'payment_authorization',
        reason: 'insufficient_funds',
      },
      failedAt: new Date('2026-08-22T10:00:00Z'),
      attemptNumber: 1,
      isSynthetic: true,
    })

    const result = await processWebhookEvent(repo, {
      eventId: `${PREFIX}evt_flow`,
      rawBody: body(paymentId, 'payment.captured'),
      signatureVerified: true,
      receivedAt: new Date(),
    })

    expect(result).toMatchObject({ httpStatus: 200, status: 'processed' })

    const updated = await prisma.paymentAttempt.findUnique({
      where: { razorpayPaymentId: paymentId },
    })
    expect(updated!.status).toBe('recovered')

    const evt = await prisma.webhookEvent.findUnique({ where: { eventId: `${PREFIX}evt_flow` } })
    expect(evt!.status).toBe('processed')
    expect(evt!.paymentAttemptId).toBe(updated!.id)
  })

  it('marks an unknown payment unmatched in the database', async () => {
    const result = await processWebhookEvent(repo, {
      eventId: `${PREFIX}evt_unmatched`,
      rawBody: body(`${PREFIX}pay_never`),
      signatureVerified: true,
      receivedAt: new Date(),
    })

    expect(result.status).toBe('unmatched')
    const evt = await prisma.webhookEvent.findUnique({
      where: { eventId: `${PREFIX}evt_unmatched` },
    })
    expect(evt!.status).toBe('unmatched')
    expect(evt!.paymentAttemptId).toBeNull()
  })
})
