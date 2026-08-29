import { z } from 'zod'
import type { RazorpayFailure } from './types.js'

const nullableString = z.string().nullish().transform((v) => v ?? null)

export const razorpayPaymentEntitySchema = z.object({
  id: z.string().min(1),
  order_id: nullableString,
  amount: z.number().int().nonnegative(),
  currency: z.string().default('INR'),
  status: z.string(),
  method: nullableString,
  error_code: nullableString,
  error_description: nullableString,
  error_source: nullableString,
  error_step: nullableString,
  error_reason: nullableString,
})

export type RazorpayPaymentEntity = z.infer<typeof razorpayPaymentEntitySchema>

export const razorpayWebhookEventSchema = z.object({
  entity: z.literal('event').optional(),
  event: z.string().min(1),
  created_at: z.number().int().nonnegative().optional(),
  payload: z.object({
    payment: z.object({ entity: razorpayPaymentEntitySchema }),
  }),
})

export type RazorpayWebhookEvent = z.infer<typeof razorpayWebhookEventSchema>

export const HANDLED_EVENTS = ['payment.failed', 'payment.captured'] as const
export type HandledEvent = (typeof HANDLED_EVENTS)[number]

export function isHandledEvent(event: string): event is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(event)
}

export function failureFromEntity(entity: RazorpayPaymentEntity): RazorpayFailure {
  return {
    code: entity.error_code,
    description: entity.error_description,
    source: entity.error_source,
    step: entity.error_step,
    reason: entity.error_reason,
  }
}
