import { Prisma, prisma } from '@revenue/db'
import type { ChargeOutcome } from '@revenue/core'
import type {
  IngestPaymentInput,
  IngestRepo,
  KnownPayment,
  StoredEvent,
  WebhookStatus,
} from './repo.js'

const asJson = (value: unknown): Prisma.InputJsonValue =>
  (value ?? Prisma.JsonNull) as Prisma.InputJsonValue

export class PrismaIngestRepo implements IngestRepo {
  async storeEvent(event: StoredEvent): Promise<'stored' | 'duplicate'> {
    try {
      await prisma.webhookEvent.create({
        data: {
          eventId: event.eventId,
          event: event.event,
          rawBody: event.rawBody,
          signatureVerified: event.signatureVerified,
          payload: asJson(event.payload),
          receivedAt: event.receivedAt,
          status: 'received',
        },
      })
      return 'stored'
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return 'duplicate'
      }
      throw err
    }
  }

  async markEvent(
    eventId: string,
    status: WebhookStatus,
    details: { paymentAttemptId?: string | null; note?: string | null },
  ): Promise<void> {
    await prisma.webhookEvent.update({
      where: { eventId },
      data: {
        status,
        paymentAttemptId: details.paymentAttemptId ?? null,
        note: details.note ?? null,
        processedAt: new Date(),
      },
    })
  }

  async findPaymentByProviderId(razorpayPaymentId: string): Promise<KnownPayment | null> {
    const row = await prisma.paymentAttempt.findUnique({
      where: { razorpayPaymentId },
      select: { id: true, razorpayPaymentId: true, amountPaise: true, failedAt: true },
    })
    return row
  }

  async applyChargeOutcome(payment: KnownPayment, outcome: ChargeOutcome): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          paymentAttemptId: payment.id,
          event: 'outcome_recorded',
          inputSnapshot: asJson({
            providerRef: outcome.providerRef,
            status: outcome.status,
            source: outcome.source,
          }),
          ruleFired: null,
          reasoning: null,
          occurredAt: outcome.settledAt,
        },
      })

      await tx.paymentAttempt.update({
        where: { id: payment.id },
        data: { status: outcome.status === 'succeeded' ? 'recovered' : 'failed' },
      })

      await tx.action.updateMany({
        where: { paymentAttemptId: payment.id, status: { in: ['executing', 'scheduled'] } },
        data: {
          status: outcome.status === 'succeeded' ? 'succeeded' : 'failed',
          executedAt: outcome.settledAt,
          outcome: asJson(outcome),
        },
      })
    })
  }

  async ingestFailedPayment(input: IngestPaymentInput): Promise<KnownPayment> {
    const customer = await prisma.customer.upsert({
      where: { externalId: input.customerExternalId },
      create: { externalId: input.customerExternalId },
      update: {},
      select: { id: true },
    })

    const payment = await prisma.paymentAttempt.upsert({
      where: { razorpayPaymentId: input.razorpayPaymentId },
      create: {
        razorpayPaymentId: input.razorpayPaymentId,
        razorpayOrderId: input.razorpayOrderId,
        customerId: customer.id,
        amountPaise: input.amountPaise,
        method: input.method,
        status: 'failed',
        errorCode: input.failure.code,
        errorDescription: input.failure.description,
        errorSource: input.failure.source,
        errorStep: input.failure.step,
        errorReason: input.failure.reason,
        failedAt: input.failedAt,
        attemptNumber: input.attemptNumber,
        isSynthetic: input.isSynthetic,
        syntheticTrueCause: input.syntheticTrueCause ?? null,
        syntheticIncidentId: input.syntheticIncidentId ?? null,
        syntheticSubtype: input.syntheticSubtype ?? null,
        recoverableUnder: asJson(input.recoverableUnder),
        evalSplit: input.evalSplit ?? null,
        datasetVersion: input.datasetVersion ?? null,
      },
      update: {},
      select: { id: true, razorpayPaymentId: true, amountPaise: true, failedAt: true },
    })

    await prisma.auditLog.create({
      data: {
        paymentAttemptId: payment.id,
        event: 'ingested',
        inputSnapshot: asJson({
          reason: input.failure.reason,
          source: input.failure.source,
          step: input.failure.step,
          amountPaise: input.amountPaise,
          method: input.method,
        }),
        occurredAt: input.failedAt,
      },
    })

    return payment
  }
}
