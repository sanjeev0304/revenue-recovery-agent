import { z } from 'zod'

export const rootCauseSchema = z.enum([
  'INSUFFICIENT_FUNDS',
  'AUTH_FAILED',
  'CUSTOMER_ABANDONED',
  'ISSUER_DOWNTIME',
  'GATEWAY_DOWNTIME',
  'INSTRUMENT_INVALID',
  'RISK_DECLINE',
  'OPAQUE_BANK_DECLINE',
  'TECHNICAL_UNRESOLVED',
  'UNKNOWN',
])
export type RootCause = z.infer<typeof rootCauseSchema>

export const paymentMethodSchema = z.enum(['card', 'upi'])
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export const paymentStatusSchema = z.enum([
  'failed',
  'in_progress',
  'recovered',
  'abandoned',
  'escalated',
])
export type PaymentStatus = z.infer<typeof paymentStatusSchema>

export const classifierKindSchema = z.enum(['deterministic', 'llm'])
export type ClassifierKind = z.infer<typeof classifierKindSchema>

export const actionTypeSchema = z.enum([
  'retry_charge',
  'issue_payment_link',
  'send_nudge',
  'escalate',
])
export type ActionType = z.infer<typeof actionTypeSchema>

export const actionStatusSchema = z.enum([
  'proposed',
  'vetoed',
  'scheduled',
  'executing',
  'succeeded',
  'failed',
])
export type ActionStatus = z.infer<typeof actionStatusSchema>

export const auditEventSchema = z.enum([
  'ingested',
  'diagnosed',
  'action_proposed',
  'action_vetoed',
  'action_executed',
  'outcome_recorded',
  'escalated',
])
export type AuditEvent = z.infer<typeof auditEventSchema>

export const evalSplitSchema = z.enum(['train', 'holdout'])
export type EvalSplit = z.infer<typeof evalSplitSchema>

export const evalArmSchema = z.enum(['baseline', 'agent'])
export type EvalArm = z.infer<typeof evalArmSchema>

export const errorSourceSchema = z.enum([
  'customer',
  'bank',
  'gateway',
  'razorpay',
  'network',
])
export type ErrorSource = z.infer<typeof errorSourceSchema>

export const errorStepSchema = z.enum([
  'payment_initiation',
  'payment_authentication',
  'payment_authorization',
])
export type ErrorStep = z.infer<typeof errorStepSchema>

export type Paise = number

export interface RazorpayFailure {
  code: string | null
  description: string | null
  source: string | null
  step: string | null
  reason: string | null
}

export interface PaymentFacts {
  paymentId: string
  customerId: string
  amountPaise: Paise
  method: PaymentMethod
  failure: RazorpayFailure
  failedAt: Date
  attemptNumber: number
}

export interface CustomerFacts {
  customerId: string
  timezone: string
  optedOut: boolean
}

export interface AttemptHistory {
  chargeAttempts: number
  lastChargeAttemptAt: Date | null
  contactsForPayment: number
  contactsForCustomerLast7d: number
  usedIdempotencyKeys: ReadonlySet<string>
}

export interface Diagnosis {
  rootCause: RootCause
  confidence: number
  classifier: ClassifierKind
  evidence: string[]
}

export interface ProposedAction {
  type: ActionType
  scheduledFor: Date | null
  idempotencyKey: string
  payload: Record<string, unknown>
}

export type GuardrailVerdict =
  | { allowed: true }
  | { allowed: false; vetoedBy: string; reason: string }

export interface Decision {
  paymentId: string
  rootCause: RootCause
  confidence: number
  classifier: ClassifierKind
  razorpayReason: string | null
  razorpaySource: string | null
  razorpayStep: string | null
  proposedAction: ProposedAction | null
  guardrailVerdict: GuardrailVerdict
  scheduledFor: Date | null
  evidence: string[]
}
