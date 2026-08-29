import { z } from 'zod'
import type { PaymentMethod, Paise, RazorpayFailure } from './types.js'

export const chargeAdapterKindSchema = z.enum(['razorpay', 'simulated'])
export type ChargeAdapterKind = z.infer<typeof chargeAdapterKindSchema>

export interface ChargeRequest {
  paymentId: string
  idempotencyKey: string
  amountPaise: Paise
  method: PaymentMethod
  attemptedAt: Date
}

export type ChargeAck =
  | { accepted: true; providerRef: string; attemptedAt: Date }
  | { accepted: false; rejection: { code: string; message: string }; attemptedAt: Date }

export type ChargeOutcome =
  | {
      status: 'succeeded'
      paymentId: string
      providerRef: string
      amountPaise: Paise
      settledAt: Date
      source: ChargeAdapterKind
    }
  | {
      status: 'failed'
      paymentId: string
      providerRef: string
      failure: RazorpayFailure
      settledAt: Date
      source: ChargeAdapterKind
    }

export interface ChargeOutcomeAdapter {
  readonly kind: ChargeAdapterKind
  attemptCharge(request: ChargeRequest): Promise<ChargeAck>
}

export type Intervention = 'retry_charge' | 'issue_payment_link' | 'send_nudge'

export const recoverabilityOutcomeSchema = z.object({
  succeeds: z.boolean(),
  afterMs: z.number().int().nonnegative().nullable(),
})

export const recoverabilityOracleSchema = z.object({
  retry_charge: recoverabilityOutcomeSchema,
  issue_payment_link: recoverabilityOutcomeSchema,
  send_nudge: recoverabilityOutcomeSchema,
})

export type RecoverabilityOracle = z.infer<typeof recoverabilityOracleSchema>

export function oracleAllows(
  oracle: RecoverabilityOracle,
  intervention: Intervention,
  failedAt: Date,
  attemptedAt: Date,
): boolean {
  const outcome = oracle[intervention]
  if (!outcome.succeeds) return false
  if (outcome.afterMs === null) return false
  return attemptedAt.getTime() - failedAt.getTime() >= outcome.afterMs
}
