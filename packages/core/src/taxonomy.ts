import type { PaymentMethod, RootCause } from './types.js'

export interface ReasonMapping {
  reason: string
  rootCause: RootCause
  methods: readonly PaymentMethod[]
}

export const REASON_MAPPINGS: readonly ReasonMapping[] = [
  { reason: 'insufficient_funds', rootCause: 'INSUFFICIENT_FUNDS', methods: ['card', 'upi'] },

  { reason: 'transaction_limit_exceeded', rootCause: 'TRANSACTION_LIMIT_EXCEEDED', methods: ['card', 'upi'] },

  { reason: 'authentication_failed', rootCause: 'AUTH_FAILED', methods: ['card', 'upi'] },
  { reason: 'incorrect_cvv', rootCause: 'AUTH_FAILED', methods: ['card'] },

  { reason: 'payment_cancelled', rootCause: 'CUSTOMER_ABANDONED', methods: ['card', 'upi'] },
  { reason: 'payment_timed_out', rootCause: 'CUSTOMER_ABANDONED', methods: ['card', 'upi'] },
  { reason: 'payment_collect_request_expired', rootCause: 'CUSTOMER_ABANDONED', methods: ['upi'] },

  { reason: 'bank_technical_error', rootCause: 'ISSUER_DOWNTIME', methods: ['card', 'upi'] },

  { reason: 'gateway_technical_error', rootCause: 'GATEWAY_DOWNTIME', methods: ['card', 'upi'] },

  { reason: 'card_expired', rootCause: 'INSTRUMENT_INVALID', methods: ['card'] },
  { reason: 'debit_instrument_blocked', rootCause: 'INSTRUMENT_INVALID', methods: ['card', 'upi'] },
  { reason: 'debit_instrument_inactive', rootCause: 'INSTRUMENT_INVALID', methods: ['card', 'upi'] },
  { reason: 'card_not_enrolled', rootCause: 'INSTRUMENT_INVALID', methods: ['card'] },
  { reason: 'card_disabled_for_online_payments', rootCause: 'INSTRUMENT_INVALID', methods: ['card'] },
  { reason: 'invalid_vpa', rootCause: 'INSTRUMENT_INVALID', methods: ['upi'] },

  { reason: 'payment_risk_check_failed', rootCause: 'RISK_DECLINE', methods: ['card', 'upi'] },

  { reason: 'card_declined', rootCause: 'OPAQUE_BANK_DECLINE', methods: ['card'] },
  { reason: 'payment_failed', rootCause: 'OPAQUE_BANK_DECLINE', methods: ['card', 'upi'] },
  { reason: 'payment_declined', rootCause: 'OPAQUE_BANK_DECLINE', methods: ['card', 'upi'] },

  { reason: 'vpa_resolution_failed', rootCause: 'TECHNICAL_UNRESOLVED', methods: ['upi'] },
  { reason: 'credit_failed', rootCause: 'TECHNICAL_UNRESOLVED', methods: ['card', 'upi'] },
] as const

const BY_REASON = new Map(REASON_MAPPINGS.map((m) => [m.reason, m]))

export function lookupReason(reason: string): ReasonMapping | undefined {
  return BY_REASON.get(reason)
}

export function reasonsForMethod(method: PaymentMethod): readonly ReasonMapping[] {
  return REASON_MAPPINGS.filter((m) => m.methods.includes(method))
}

export function reasonsForCause(
  rootCause: RootCause,
  method?: PaymentMethod,
): readonly ReasonMapping[] {
  return REASON_MAPPINGS.filter(
    (m) => m.rootCause === rootCause && (method === undefined || m.methods.includes(method)),
  )
}

export const LLM_CLASSIFIED_CAUSES: readonly RootCause[] = ['OPAQUE_BANK_DECLINE', 'UNKNOWN']

export const PERMANENT_FAILURE_CAUSES: readonly RootCause[] = [
  'RISK_DECLINE',
  'INSTRUMENT_INVALID',
  'TECHNICAL_UNRESOLVED',
]
