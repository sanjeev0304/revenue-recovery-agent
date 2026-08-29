import type { PaymentMethod, RootCause } from '@revenue/core'

export const DATASET_VERSION = 'v1'
export const TOTAL_RECORDS = 1500
export const HOLDOUT_RECORDS = 400
export const SPAN_DAYS = 45
export const SPAN_END_UTC = '2026-08-28T00:00:00.000Z'
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export const BASE_AMOUNT_MEDIAN_PAISE = 120_000
export const AMOUNT_SIGMA = 1.1
export const AMOUNT_MIN_PAISE = 5_000
export const AMOUNT_MAX_PAISE = 80_000_000

export type Subtype = 'daily_cap' | 'per_txn_cap'

export const CAUSE_SHARES: ReadonlyArray<readonly [RootCause, number]> = [
  ['INSUFFICIENT_FUNDS', 0.19],
  ['TRANSACTION_LIMIT_EXCEEDED', 0.03],
  ['CUSTOMER_ABANDONED', 0.2],
  ['OPAQUE_BANK_DECLINE', 0.16],
  ['AUTH_FAILED', 0.13],
  ['ISSUER_DOWNTIME', 0.09],
  ['GATEWAY_DOWNTIME', 0.06],
  ['INSTRUMENT_INVALID', 0.07],
  ['RISK_DECLINE', 0.04],
  ['TECHNICAL_UNRESOLVED', 0.03],
]

export const HOUR_BASE_WEIGHTS: readonly number[] = [
  2.5, 1.5, 1.0, 0.8, 0.7, 1.0, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 6.5, 6.0, 5.5, 5.0, 5.0, 5.5, 6.0,
  6.5, 7.0, 6.5, 5.5, 3.5,
]

export interface HourSkew {
  hours: readonly number[]
  k: number
}

export const HOUR_SKEW: Readonly<Partial<Record<RootCause, HourSkew>>> = {
  AUTH_FAILED: { hours: [22, 23, 0, 1], k: 3.45 },
  CUSTOMER_ABANDONED: { hours: [22, 23, 0], k: 3.46 },
  ISSUER_DOWNTIME: { hours: [0, 1, 2, 3], k: 5.71 },
  RISK_DECLINE: { hours: [1, 2, 3, 4], k: 5.27 },
  GATEWAY_DOWNTIME: { hours: [0, 1, 2, 3], k: 1.61 },
}

export const TLE_DAILY_HOUR_SKEW: HourSkew = { hours: [18, 19, 20, 21, 22], k: 3.0 }

export const AMOUNT_MULTIPLIER: Readonly<Record<RootCause, number>> = {
  INSUFFICIENT_FUNDS: 2.2,
  TRANSACTION_LIMIT_EXCEEDED: 3.0,
  AUTH_FAILED: 1.0,
  CUSTOMER_ABANDONED: 1.6,
  ISSUER_DOWNTIME: 1.0,
  GATEWAY_DOWNTIME: 1.0,
  INSTRUMENT_INVALID: 1.0,
  RISK_DECLINE: 3.5,
  OPAQUE_BANK_DECLINE: 1.2,
  TECHNICAL_UNRESOLVED: 1.0,
  UNKNOWN: 1.0,
}

export const P_UPI: Readonly<Record<RootCause, number>> = {
  INSUFFICIENT_FUNDS: 0.7,
  TRANSACTION_LIMIT_EXCEEDED: 0.75,
  AUTH_FAILED: 0.5,
  CUSTOMER_ABANDONED: 0.7,
  ISSUER_DOWNTIME: 0.7,
  GATEWAY_DOWNTIME: 0.7,
  INSTRUMENT_INVALID: 0.3,
  RISK_DECLINE: 0.7,
  OPAQUE_BANK_DECLINE: 0.7,
  TECHNICAL_UNRESOLVED: 0.7,
  UNKNOWN: 0.7,
}

export const PRIOR_ATTEMPTS_PMF: Readonly<Record<RootCause, readonly number[]>> = {
  INSUFFICIENT_FUNDS: [0.55, 0.3, 0.12, 0.03],
  TRANSACTION_LIMIT_EXCEEDED: [0.8, 0.16, 0.04, 0],
  AUTH_FAILED: [0.3, 0.38, 0.24, 0.08],
  CUSTOMER_ABANDONED: [0.72, 0.22, 0.06, 0],
  ISSUER_DOWNTIME: [0.48, 0.33, 0.15, 0.04],
  GATEWAY_DOWNTIME: [0.5, 0.32, 0.15, 0.03],
  INSTRUMENT_INVALID: [0.22, 0.34, 0.3, 0.14],
  RISK_DECLINE: [0.45, 0.35, 0.16, 0.04],
  OPAQUE_BANK_DECLINE: [0.62, 0.26, 0.1, 0.02],
  TECHNICAL_UNRESOLVED: [0.7, 0.23, 0.07, 0],
  UNKNOWN: [1, 0, 0, 0],
}

export const TLE_PER_TXN_PRIOR_PMF: readonly number[] = [0.75, 0.2, 0.05, 0]

export const DAY_OF_MONTH_BUCKETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 5, 0.3],
  [6, 12, 0.6],
  [13, 21, 1.0],
  [22, 26, 2.1],
  [27, 31, 2.6],
]

export const BASE_DAY_LIFT_DAYS = [1, 2, 3, 4, 5] as const
export const BASE_DAY_LIFT = 1.25

export const MASK_RATE: Readonly<Record<RootCause, number>> = {
  ISSUER_DOWNTIME: 0.25,
  GATEWAY_DOWNTIME: 0.22,
  AUTH_FAILED: 0.2,
  INSUFFICIENT_FUNDS: 0.18,
  TECHNICAL_UNRESOLVED: 0.15,
  INSTRUMENT_INVALID: 0.12,
  CUSTOMER_ABANDONED: 0.1,
  TRANSACTION_LIMIT_EXCEEDED: 0.08,
  RISK_DECLINE: 0,
  OPAQUE_BANK_DECLINE: 0,
  UNKNOWN: 0,
}

export const OPAQUE_REASONS: Readonly<Record<PaymentMethod, readonly string[]>> = {
  card: ['card_declined', 'payment_failed', 'payment_declined'],
  upi: ['payment_failed', 'payment_declined'],
}

export const OPAQUE_SOURCES: ReadonlyArray<readonly [string, number]> = [
  ['bank', 0.72],
  ['gateway', 0.18],
  ['razorpay', 0.1],
]

export const OPAQUE_STEPS: ReadonlyArray<readonly [string, number]> = [
  ['payment_authorization', 0.82],
  ['payment_authentication', 0.12],
  ['payment_initiation', 0.06],
]

export interface IncidentSpec {
  incidents: number
  sizeMin: number
  sizeMax: number
  spreadMinMs: number
  spreadMaxMs: number
}

export const INCIDENTS: Readonly<Partial<Record<RootCause, IncidentSpec>>> = {
  ISSUER_DOWNTIME: {
    incidents: 14,
    sizeMin: 6,
    sizeMax: 14,
    spreadMinMs: 12 * 60_000,
    spreadMaxMs: 45 * 60_000,
  },
  GATEWAY_DOWNTIME: {
    incidents: 9,
    sizeMin: 7,
    sizeMax: 13,
    spreadMinMs: 8 * 60_000,
    spreadMaxMs: 25 * 60_000,
  },
}

export const TLE_PER_TXN_SHARE = 0.3
export const TLE_PER_TXN_CLUSTERS: ReadonlyArray<readonly [number, number, number]> = [
  [0.7, 10_000_100, 11_500_000],
  [0.3, 20_000_100, 23_000_000],
]

export const CUSTOMER_POOL = 900
export const OPT_OUT_RATE = 0.06
export const CUSTOMER_TIMEZONE = 'Asia/Kolkata'

export const REASON_SOURCE_STEP: Readonly<
  Record<string, ReadonlyArray<readonly [string, string, number]>>
> = {
  insufficient_funds: [['bank', 'payment_authorization', 1]],
  transaction_limit_exceeded: [['bank', 'payment_authorization', 1]],
  authentication_failed: [
    ['customer', 'payment_authentication', 0.5],
    ['bank', 'payment_authentication', 0.5],
  ],
  incorrect_cvv: [['customer', 'payment_authentication', 1]],
  payment_cancelled: [['customer', 'payment_initiation', 1]],
  payment_timed_out: [['customer', 'payment_authentication', 1]],
  payment_collect_request_expired: [['customer', 'payment_initiation', 1]],
  bank_technical_error: [['bank', 'payment_authorization', 1]],
  gateway_technical_error: [['gateway', 'payment_authorization', 1]],
  card_expired: [['bank', 'payment_initiation', 1]],
  card_not_enrolled: [['bank', 'payment_authentication', 1]],
  card_disabled_for_online_payments: [['bank', 'payment_authorization', 1]],
  debit_instrument_blocked: [['bank', 'payment_authorization', 1]],
  debit_instrument_inactive: [['bank', 'payment_authorization', 1]],
  invalid_vpa: [['customer', 'payment_initiation', 1]],
  payment_risk_check_failed: [['razorpay', 'payment_authorization', 1]],
  vpa_resolution_failed: [['gateway', 'payment_initiation', 1]],
  credit_failed: [['razorpay', 'payment_initiation', 1]],
  card_declined: [],
  payment_failed: [],
  payment_declined: [],
}

export const REASON_DESCRIPTION: Readonly<Record<string, string>> = {
  insufficient_funds: 'Your account does not have sufficient balance for this transaction.',
  transaction_limit_exceeded: 'The transaction exceeds the limit set on this instrument.',
  authentication_failed: 'The payment could not be authenticated.',
  incorrect_cvv: 'The CVV entered is incorrect.',
  payment_cancelled: 'The payment was cancelled by the customer.',
  payment_timed_out: 'The customer did not complete the payment in time.',
  payment_collect_request_expired: 'The UPI collect request expired before approval.',
  bank_technical_error: 'The bank is facing a technical issue.',
  gateway_technical_error: 'The payment gateway is facing a technical issue.',
  card_expired: 'The card has expired.',
  card_not_enrolled: 'The card is not enrolled for online authentication.',
  card_disabled_for_online_payments: 'Online payments are disabled on this card.',
  debit_instrument_blocked: 'The payment instrument is blocked.',
  debit_instrument_inactive: 'The payment instrument is inactive.',
  invalid_vpa: 'The UPI ID entered is not valid.',
  payment_risk_check_failed: 'The payment was declined by a risk check.',
  vpa_resolution_failed: 'The UPI ID could not be resolved.',
  credit_failed: 'The credit to the beneficiary failed.',
  card_declined: 'The card was declined by the issuing bank.',
  payment_failed: 'The payment failed.',
  payment_declined: 'The payment was declined.',
}
