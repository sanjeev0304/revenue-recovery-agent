import type { RootCause } from '@revenue/core'
import type { Rng } from './rng.js'
import { IST_OFFSET_MS, type Subtype } from './spec.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export interface Outcome {
  succeeds: boolean
  afterMs: number | null
}

export interface Recoverability {
  retry_charge: Outcome
  issue_payment_link: Outcome
  send_nudge: Outcome
}

const NEVER: Outcome = { succeeds: false, afterMs: null }

function outcome(rng: Rng, p: number, delayMs: number): Outcome {
  return rng.bernoulli(p) ? { succeeds: true, afterMs: Math.round(delayMs) } : NEVER
}

export const INSUFFICIENT_FUNDS_FLOOR_MS = 18 * HOUR

function msToNextIstMidnight(failedAt: Date): number {
  const local = failedAt.getTime() + IST_OFFSET_MS
  const dayMs = 24 * HOUR
  const nextLocalDay = Math.floor(local / dayMs) * dayMs + dayMs
  return nextLocalDay - local
}

export function deriveRecoverability(
  rootCause: RootCause,
  subtype: Subtype | null,
  failedAt: Date,
  rng: Rng,
): Recoverability {
  switch (rootCause) {
    case 'INSUFFICIENT_FUNDS': {
      const funds = rng.lognormal(46 * HOUR, 0.65, INSUFFICIENT_FUNDS_FLOOR_MS, 120 * HOUR)
      return {
        retry_charge: outcome(rng, 0.7, funds),
        issue_payment_link: outcome(rng, 0.74, funds + rng.uniform(0, 4 * HOUR)),
        send_nudge: outcome(rng, 0.66, funds + rng.uniform(0, 8 * HOUR)),
      }
    }

    case 'TRANSACTION_LIMIT_EXCEEDED': {
      if (subtype === 'per_txn_cap') {
        const act = rng.lognormal(5 * HOUR, 1.0, 20 * MINUTE, 48 * HOUR)
        return {
          retry_charge: NEVER,
          issue_payment_link: outcome(rng, 0.55, act),
          send_nudge: outcome(rng, 0.6, act),
        }
      }
      const reset = msToNextIstMidnight(failedAt) + rng.uniform(15 * MINUTE, 3 * HOUR)
      return {
        retry_charge: outcome(rng, 1.0, reset),
        issue_payment_link: outcome(rng, 0.85, reset),
        send_nudge: outcome(rng, 0.8, reset),
      }
    }

    case 'AUTH_FAILED': {
      const act = rng.lognormal(40 * MINUTE, 1.0, 5 * MINUTE, 12 * HOUR)
      return {
        retry_charge: NEVER,
        issue_payment_link: outcome(rng, 0.62, act),
        send_nudge: outcome(rng, 0.58, act),
      }
    }

    case 'CUSTOMER_ABANDONED': {
      const act = rng.lognormal(6 * HOUR, 1.1, 30 * MINUTE, 72 * HOUR)
      return {
        retry_charge: NEVER,
        issue_payment_link: outcome(rng, 0.55, act),
        send_nudge: outcome(rng, 0.52, act),
      }
    }

    case 'ISSUER_DOWNTIME': {
      const clears = rng.lognormal(95 * MINUTE, 0.8, 20 * MINUTE, 8 * HOUR)
      return {
        retry_charge: outcome(rng, 0.88, clears),
        issue_payment_link: outcome(rng, 0.88, clears),
        send_nudge: outcome(rng, 0.45, clears),
      }
    }

    case 'GATEWAY_DOWNTIME': {
      const clears = rng.lognormal(32 * MINUTE, 0.75, 10 * MINUTE, 3 * HOUR)
      return {
        retry_charge: outcome(rng, 0.92, clears),
        issue_payment_link: outcome(rng, 0.92, clears),
        send_nudge: outcome(rng, 0.45, clears),
      }
    }

    case 'INSTRUMENT_INVALID': {
      const act = rng.lognormal(8 * HOUR, 1.2, 30 * MINUTE, 96 * HOUR)
      return {
        retry_charge: NEVER,
        issue_payment_link: outcome(rng, 0.45, act),
        send_nudge: outcome(rng, 0.48, act),
      }
    }

    case 'OPAQUE_BANK_DECLINE': {
      const clears = rng.lognormal(5.5 * HOUR, 0.9, 45 * MINUTE, 30 * HOUR)
      return {
        retry_charge: outcome(rng, 0.34, clears),
        issue_payment_link: outcome(rng, 0.3, clears),
        send_nudge: outcome(rng, 0.28, clears),
      }
    }

    case 'RISK_DECLINE':
    case 'TECHNICAL_UNRESOLVED':
    case 'UNKNOWN':
      return { retry_charge: NEVER, issue_payment_link: NEVER, send_nudge: NEVER }
  }
}
