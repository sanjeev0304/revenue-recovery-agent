import type { ChargeOutcome } from '@revenue/core'
import type { IngestRepo, KnownPayment } from './repo.js'

export type RecordResult =
  | { recorded: true; payment: KnownPayment }
  | { recorded: false; reason: 'unknown_payment' }

export async function recordChargeOutcome(
  repo: IngestRepo,
  outcome: ChargeOutcome,
): Promise<RecordResult> {
  const payment = await repo.findPaymentByProviderId(outcome.paymentId)

  if (payment === null) {
    return { recorded: false, reason: 'unknown_payment' }
  }

  await repo.applyChargeOutcome(payment, outcome)
  return { recorded: true, payment }
}
