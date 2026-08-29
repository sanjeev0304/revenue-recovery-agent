import { describe, expect, it } from 'vitest'
import { MemoryIngestRepo } from './memoryRepo.js'
import { importBatch, type ImportRecord } from './importer.js'

const oracle = {
  retry_charge: { succeeds: true, afterMs: 86_400_000 },
  issue_payment_link: { succeeds: false, afterMs: null },
  send_nudge: { succeeds: false, afterMs: null },
}

const record = (over: Partial<ImportRecord> = {}): ImportRecord => ({
  razorpayPaymentId: over.razorpayPaymentId ?? 'pay_v1_00001',
  razorpayOrderId: 'order_v1_00001',
  customerExternalId: 'cust_00001',
  amountPaise: 250_000,
  method: 'upi',
  errorCode: 'BAD_REQUEST_ERROR',
  errorDescription: 'Insufficient balance',
  errorSource: 'bank',
  errorStep: 'payment_authorization',
  errorReason: 'insufficient_funds',
  failedAt: new Date('2026-08-20T10:00:00Z'),
  attemptNumber: 1,
  trueCause: 'INSUFFICIENT_FUNDS',
  recoverableUnder: over.recoverableUnder === undefined ? oracle : over.recoverableUnder,
  evalSplit: 'train',
  datasetVersion: 'v1',
  ...over,
})

describe('importBatch', () => {
  it('loads records through the shared ingest path', async () => {
    const repo = new MemoryIngestRepo()
    const result = await importBatch(repo, [
      record({ razorpayPaymentId: 'pay_a' }),
      record({ razorpayPaymentId: 'pay_b' }),
    ])

    expect(result.imported).toBe(2)
    expect(result.skipped).toEqual([])
    expect(await repo.findPaymentByProviderId('pay_a')).not.toBeNull()
  })

  it('is idempotent, so re-importing does not duplicate a payment', async () => {
    const repo = new MemoryIngestRepo()
    await importBatch(repo, [record({ razorpayPaymentId: 'pay_a' })])
    await importBatch(repo, [record({ razorpayPaymentId: 'pay_a' })])
    expect(repo.payments.size).toBe(1)
  })

  it('skips a record whose oracle fails validation rather than storing it', async () => {
    const repo = new MemoryIngestRepo()
    const result = await importBatch(repo, [
      record({ razorpayPaymentId: 'pay_bad', recoverableUnder: { retry_charge: 'nope' } }),
    ])

    expect(result.imported).toBe(0)
    expect(result.skipped[0]!.razorpayPaymentId).toBe('pay_bad')
    expect(repo.payments.size).toBe(0)
  })

  it('imports records that carry no oracle at all', async () => {
    const repo = new MemoryIngestRepo()
    const result = await importBatch(repo, [record({ recoverableUnder: null })])
    expect(result.imported).toBe(1)
  })

  it('makes imported payments visible to the same lookup the webhook uses', async () => {
    const repo = new MemoryIngestRepo()
    await importBatch(repo, [record({ razorpayPaymentId: 'pay_shared' })])
    const found = await repo.findPaymentByProviderId('pay_shared')
    expect(found?.razorpayPaymentId).toBe('pay_shared')
  })
})
