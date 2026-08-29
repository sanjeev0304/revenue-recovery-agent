import type { ChargeOutcome, PaymentMethod, RazorpayFailure, RootCause } from '@revenue/core'

export type WebhookStatus =
  | 'received'
  | 'processed'
  | 'unmatched'
  | 'ignored'
  | 'invalid'
  | 'failed'

export interface StoredEvent {
  eventId: string
  event: string
  rawBody: string
  signatureVerified: boolean
  payload: unknown
  receivedAt: Date
}

export interface KnownPayment {
  id: string
  razorpayPaymentId: string
  amountPaise: number
  failedAt: Date
}

export interface IngestPaymentInput {
  razorpayPaymentId: string
  razorpayOrderId: string | null
  customerExternalId: string
  amountPaise: number
  method: PaymentMethod
  failure: RazorpayFailure
  failedAt: Date
  attemptNumber: number
  isSynthetic: boolean
  syntheticTrueCause?: RootCause | null
  syntheticIncidentId?: string | null
  syntheticSubtype?: string | null
  recoverableUnder?: unknown
  evalSplit?: 'train' | 'holdout' | null
  datasetVersion?: string | null
}

export interface IngestRepo {
  storeEvent(event: StoredEvent): Promise<'stored' | 'duplicate'>
  markEvent(
    eventId: string,
    status: WebhookStatus,
    details: { paymentAttemptId?: string | null; note?: string | null },
  ): Promise<void>
  findPaymentByProviderId(razorpayPaymentId: string): Promise<KnownPayment | null>
  applyChargeOutcome(payment: KnownPayment, outcome: ChargeOutcome): Promise<void>
  ingestFailedPayment(input: IngestPaymentInput): Promise<KnownPayment>
}
