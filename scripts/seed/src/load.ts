import { prisma } from '@revenue/db'
import type { Dataset } from './generate.js'

export interface LoadResult {
  customers: number
  payments: number
}

export async function load(dataset: Dataset, datasetVersion: string): Promise<LoadResult> {
  await prisma.auditLog.deleteMany({})
  await prisma.action.deleteMany({})
  await prisma.diagnosis.deleteMany({})
  await prisma.paymentAttempt.deleteMany({ where: { isSynthetic: true } })
  await prisma.customer.deleteMany({
    where: { externalId: { startsWith: 'cust_' } },
  })

  await prisma.customer.createMany({
    data: dataset.customers.map((c) => ({
      externalId: c.externalId,
      timezone: c.timezone,
      optedOut: c.optedOut,
    })),
  })

  const customers = await prisma.customer.findMany({ select: { id: true, externalId: true } })
  const idByExternal = new Map(customers.map((c) => [c.externalId, c.id]))

  const rows = dataset.payments.map((p) => {
    const customerId = idByExternal.get(p.customerExternalId)
    if (customerId === undefined) {
      throw new Error(`customer ${p.customerExternalId} was not loaded`)
    }
    return {
      razorpayPaymentId: p.razorpayPaymentId,
      razorpayOrderId: p.razorpayOrderId,
      customerId,
      amountPaise: p.amountPaise,
      method: p.method,
      status: 'failed' as const,
      errorCode: p.errorCode,
      errorDescription: p.errorDescription,
      errorSource: p.errorSource,
      errorStep: p.errorStep,
      errorReason: p.errorReason,
      failedAt: p.failedAt,
      attemptNumber: p.attemptNumber,
      isSynthetic: true,
      syntheticTrueCause: p.trueCause,
      syntheticIncidentId: p.incidentId,
      syntheticSubtype: p.subtype,
      recoverableUnder: p.recoverableUnder as unknown as object,
      evalSplit: p.evalSplit,
      datasetVersion,
    }
  })

  for (let i = 0; i < rows.length; i += 200) {
    await prisma.paymentAttempt.createMany({ data: rows.slice(i, i + 200) })
  }

  return { customers: dataset.customers.length, payments: rows.length }
}
