import type { ChargeOutcome } from '@revenue/core'
import type {
  IngestPaymentInput,
  IngestRepo,
  KnownPayment,
  StoredEvent,
  WebhookStatus,
} from './repo.js'

export interface MemoryEventRow extends StoredEvent {
  status: WebhookStatus
  paymentAttemptId: string | null
  note: string | null
}

export class MemoryIngestRepo implements IngestRepo {
  readonly events = new Map<string, MemoryEventRow>()
  readonly payments = new Map<string, KnownPayment>()
  readonly outcomes: Array<{ payment: KnownPayment; outcome: ChargeOutcome }> = []

  seedPayment(payment: KnownPayment): void {
    this.payments.set(payment.razorpayPaymentId, payment)
  }

  async storeEvent(event: StoredEvent): Promise<'stored' | 'duplicate'> {
    if (this.events.has(event.eventId)) return 'duplicate'
    this.events.set(event.eventId, {
      ...event,
      status: 'received',
      paymentAttemptId: null,
      note: null,
    })
    return 'stored'
  }

  async markEvent(
    eventId: string,
    status: WebhookStatus,
    details: { paymentAttemptId?: string | null; note?: string | null },
  ): Promise<void> {
    const row = this.events.get(eventId)
    if (row === undefined) throw new Error(`markEvent for unknown event ${eventId}`)
    row.status = status
    row.paymentAttemptId = details.paymentAttemptId ?? null
    row.note = details.note ?? null
  }

  async findPaymentByProviderId(razorpayPaymentId: string): Promise<KnownPayment | null> {
    return this.payments.get(razorpayPaymentId) ?? null
  }

  async applyChargeOutcome(payment: KnownPayment, outcome: ChargeOutcome): Promise<void> {
    this.outcomes.push({ payment, outcome })
  }

  async ingestFailedPayment(input: IngestPaymentInput): Promise<KnownPayment> {
    const existing = this.payments.get(input.razorpayPaymentId)
    if (existing !== undefined) return existing
    const payment: KnownPayment = {
      id: `local_${this.payments.size}`,
      razorpayPaymentId: input.razorpayPaymentId,
      amountPaise: input.amountPaise,
      failedAt: input.failedAt,
    }
    this.payments.set(input.razorpayPaymentId, payment)
    return payment
  }
}
