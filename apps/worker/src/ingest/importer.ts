import { recoverabilityOracleSchema, type PaymentMethod, type RootCause } from '@revenue/core'
import type { IngestPaymentInput, IngestRepo } from './repo.js'

export interface ImportRecord {
  razorpayPaymentId: string
  razorpayOrderId: string | null
  customerExternalId: string
  amountPaise: number
  method: PaymentMethod
  errorCode: string | null
  errorDescription: string | null
  errorSource: string | null
  errorStep: string | null
  errorReason: string | null
  failedAt: Date
  attemptNumber: number
  trueCause?: RootCause | null
  incidentId?: string | null
  subtype?: string | null
  recoverableUnder?: unknown
  evalSplit?: 'train' | 'holdout' | null
  datasetVersion?: string | null
}

export interface ImportResult {
  imported: number
  skipped: Array<{ razorpayPaymentId: string; reason: string }>
}

export async function importBatch(
  repo: IngestRepo,
  records: readonly ImportRecord[],
): Promise<ImportResult> {
  const skipped: ImportResult['skipped'] = []
  let imported = 0

  for (const record of records) {
    if (record.recoverableUnder !== undefined && record.recoverableUnder !== null) {
      const parsed = recoverabilityOracleSchema.safeParse(record.recoverableUnder)
      if (!parsed.success) {
        skipped.push({
          razorpayPaymentId: record.razorpayPaymentId,
          reason: `recoverableUnder failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        })
        continue
      }
    }

    const input: IngestPaymentInput = {
      razorpayPaymentId: record.razorpayPaymentId,
      razorpayOrderId: record.razorpayOrderId,
      customerExternalId: record.customerExternalId,
      amountPaise: record.amountPaise,
      method: record.method,
      failure: {
        code: record.errorCode,
        description: record.errorDescription,
        source: record.errorSource,
        step: record.errorStep,
        reason: record.errorReason,
      },
      failedAt: record.failedAt,
      attemptNumber: record.attemptNumber,
      isSynthetic: true,
      syntheticTrueCause: record.trueCause ?? null,
      syntheticIncidentId: record.incidentId ?? null,
      syntheticSubtype: record.subtype ?? null,
      recoverableUnder: record.recoverableUnder,
      evalSplit: record.evalSplit ?? null,
      datasetVersion: record.datasetVersion ?? null,
    }

    await repo.ingestFailedPayment(input)
    imported++
  }

  return { imported, skipped }
}
