import {
  failureFromEntity,
  isHandledEvent,
  razorpayWebhookEventSchema,
  type ChargeOutcome,
} from '@revenue/core'
import type { IngestRepo, WebhookStatus } from './repo.js'
import { recordChargeOutcome } from './recordChargeOutcome.js'

export interface ProcessInput {
  eventId: string
  rawBody: Buffer
  signatureVerified: boolean
  receivedAt: Date
}

export interface ProcessResult {
  httpStatus: 200 | 500
  status: WebhookStatus | 'duplicate'
  note: string | null
}

export async function processWebhookEvent(
  repo: IngestRepo,
  input: ProcessInput,
): Promise<ProcessResult> {
  const text = input.rawBody.toString('utf8')

  let parsedJson: unknown = null
  let eventName = 'unparseable'
  try {
    parsedJson = JSON.parse(text)
    const maybe = parsedJson as { event?: unknown }
    if (typeof maybe.event === 'string') eventName = maybe.event
  } catch {
    parsedJson = null
  }

  const stored = await repo.storeEvent({
    eventId: input.eventId,
    event: eventName,
    rawBody: text,
    signatureVerified: input.signatureVerified,
    payload: parsedJson,
    receivedAt: input.receivedAt,
  })

  if (stored === 'duplicate') {
    return { httpStatus: 200, status: 'duplicate', note: 'event id already seen' }
  }

  if (parsedJson === null) {
    await repo.markEvent(input.eventId, 'invalid', { note: 'body was not valid JSON' })
    return { httpStatus: 200, status: 'invalid', note: 'body was not valid JSON' }
  }

  const parsed = razorpayWebhookEventSchema.safeParse(parsedJson)
  if (!parsed.success) {
    const note = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
      .slice(0, 500)
    await repo.markEvent(input.eventId, 'invalid', { note })
    return { httpStatus: 200, status: 'invalid', note }
  }

  if (!isHandledEvent(parsed.data.event)) {
    const note = `event ${parsed.data.event} is not handled`
    await repo.markEvent(input.eventId, 'ignored', { note })
    return { httpStatus: 200, status: 'ignored', note }
  }

  const entity = parsed.data.payload.payment.entity

  const outcome: ChargeOutcome =
    parsed.data.event === 'payment.captured'
      ? {
          status: 'succeeded',
          paymentId: entity.id,
          providerRef: entity.id,
          amountPaise: entity.amount,
          settledAt: input.receivedAt,
          source: 'razorpay',
        }
      : {
          status: 'failed',
          paymentId: entity.id,
          providerRef: entity.id,
          failure: failureFromEntity(entity),
          settledAt: input.receivedAt,
          source: 'razorpay',
        }

  const result = await recordChargeOutcome(repo, outcome)

  if (!result.recorded) {
    const note = `no local payment matches ${entity.id}`
    await repo.markEvent(input.eventId, 'unmatched', { note })
    return { httpStatus: 200, status: 'unmatched', note }
  }

  await repo.markEvent(input.eventId, 'processed', { paymentAttemptId: result.payment.id })
  return { httpStatus: 200, status: 'processed', note: null }
}
