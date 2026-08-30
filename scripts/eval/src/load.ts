import { prisma } from '@revenue/db'
import {
  recoverabilityOracleSchema,
  reasonsForCause,
  type EvalSplit,
} from '@revenue/core'
import type { EvalRecord } from './simulate.js'

const OPAQUE_REASONS = new Set(
  reasonsForCause('OPAQUE_BANK_DECLINE').map((m) => m.reason),
)

export interface LoadResult {
  records: EvalRecord[]
  datasetVersion: string
  skipped: number
}

export async function loadRecords(
  split: EvalSplit,
  limit?: number,
): Promise<LoadResult> {
  const rows = await prisma.paymentAttempt.findMany({
    where: { evalSplit: split, isSynthetic: true },
    orderBy: { failedAt: 'asc' },
    ...(limit === undefined ? {} : { take: limit }),
    select: {
      id: true,
      razorpayPaymentId: true,
      customerId: true,
      amountPaise: true,
      method: true,
      errorCode: true,
      errorDescription: true,
      errorSource: true,
      errorStep: true,
      errorReason: true,
      failedAt: true,
      attemptNumber: true,
      recoverableUnder: true,
      syntheticTrueCause: true,
      syntheticIncidentId: true,
      datasetVersion: true,
      customer: { select: { timezone: true, optedOut: true } },
    },
  })

  const records: EvalRecord[] = []
  let skipped = 0
  let datasetVersion = 'unknown'

  for (const row of rows) {
    const parsed = recoverabilityOracleSchema.safeParse(row.recoverableUnder)
    if (!parsed.success || row.syntheticTrueCause === null) {
      skipped++
      continue
    }
    if (row.datasetVersion !== null) datasetVersion = row.datasetVersion

    const opaqueReason =
      row.errorReason !== null && OPAQUE_REASONS.has(row.errorReason)

    records.push({
      id: row.id,
      razorpayPaymentId: row.razorpayPaymentId,
      timezone: row.customer.timezone,
      optedOut: row.customer.optedOut,
      oracle: parsed.data,
      trueCause: row.syntheticTrueCause,
      incidentId: row.syntheticIncidentId,
      opaqueReason,
      masked: opaqueReason && row.syntheticTrueCause !== 'OPAQUE_BANK_DECLINE',
      facts: {
        paymentId: row.razorpayPaymentId,
        customerId: row.customerId,
        amountPaise: row.amountPaise,
        method: row.method,
        failure: {
          code: row.errorCode,
          description: row.errorDescription,
          source: row.errorSource,
          step: row.errorStep,
          reason: row.errorReason,
        },
        failedAt: row.failedAt,
        attemptNumber: row.attemptNumber,
      },
    })
  }

  return { records, datasetVersion, skipped }
}
