import {
  QUIET_HOURS_END,
  QUIET_HOURS_START,
  decide,
  localHour,
  oracleAllows,
  type Diagnosis,
  type Intervention,
  type PaymentFacts,
  type RecoverabilityOracle,
  type RootCause,
} from '@revenue/core'

export interface EvalRecord {
  id: string
  razorpayPaymentId: string
  facts: PaymentFacts
  timezone: string
  optedOut: boolean
  oracle: RecoverabilityOracle
  trueCause: RootCause
  incidentId: string | null
  opaqueReason: boolean
  masked: boolean
}

export interface RecordOutcome {
  recovered: boolean
  recoveredPaise: number
  chargeAttempts: number
  wastedChargeAttempts: number
  contacts: number
  linksIssued: number
  escalated: boolean
  vetoed: boolean
  vetoedBy: string | null
  quietHoursViolations: number
  steps: number
}

export interface SimulationContext {
  contactsByCustomer: Map<string, number>
  maxSteps: number
}

export function newContext(maxSteps = 6): SimulationContext {
  return { contactsByCustomer: new Map(), maxSteps }
}

const INTERVENTION_FOR: Record<string, Intervention | null> = {
  retry_charge: 'retry_charge',
  issue_payment_link: 'issue_payment_link',
  send_nudge: 'send_nudge',
  escalate: null,
}

function emptyOutcome(): RecordOutcome {
  return {
    recovered: false,
    recoveredPaise: 0,
    chargeAttempts: 0,
    wastedChargeAttempts: 0,
    contacts: 0,
    linksIssued: 0,
    escalated: false,
    vetoed: false,
    vetoedBy: null,
    quietHoursViolations: 0,
    steps: 0,
  }
}

function inQuietHours(at: Date, timezone: string): boolean {
  const hour = localHour(at, timezone)
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END
}

export function simulateAgent(
  record: EvalRecord,
  diagnosis: Diagnosis,
  ctx: SimulationContext,
): RecordOutcome {
  const out = emptyOutcome()

  let chargeAttempts = 0
  let lastChargeAttemptAt: Date | null = null
  let contactsForPayment = 0
  let completedSteps = 0
  let lastActionAt: Date | null = null
  const usedKeys = new Set<string>()
  let simulatedNow = record.facts.failedAt

  for (let step = 0; step < ctx.maxSteps; step++) {
    const decision = decide({
      payment: record.facts,
      customer: {
        customerId: record.facts.customerId,
        timezone: record.timezone,
        optedOut: record.optedOut,
      },
      diagnosis,
      history: {
        chargeAttempts,
        lastChargeAttemptAt,
        contactsForPayment,
        contactsForCustomerLast7d: ctx.contactsByCustomer.get(record.facts.customerId) ?? 0,
        completedSteps,
        lastActionAt,
        usedIdempotencyKeys: usedKeys,
      },
      now: simulatedNow,
    })

    const action = decision.proposedAction
    if (action === null) break

    if (!decision.guardrailVerdict.allowed) {
      out.vetoed = true
      out.vetoedBy = decision.guardrailVerdict.vetoedBy
      break
    }

    const at = action.scheduledFor ?? simulatedNow
    simulatedNow = at > simulatedNow ? at : simulatedNow
    usedKeys.add(action.idempotencyKey)
    completedSteps++
    lastActionAt = simulatedNow
    out.steps++

    if (action.type === 'escalate') {
      out.escalated = true
      break
    }

    if (action.type === 'retry_charge') {
      chargeAttempts++
      lastChargeAttemptAt = simulatedNow
      out.chargeAttempts++
      if (!record.oracle.retry_charge.succeeds) out.wastedChargeAttempts++
    }

    if (action.type === 'issue_payment_link') out.linksIssued++

    if (action.type === 'send_nudge') {
      contactsForPayment++
      out.contacts++
      ctx.contactsByCustomer.set(
        record.facts.customerId,
        (ctx.contactsByCustomer.get(record.facts.customerId) ?? 0) + 1,
      )
      if (inQuietHours(simulatedNow, record.timezone)) out.quietHoursViolations++
    }

    const intervention = INTERVENTION_FOR[action.type]
    if (intervention !== null && intervention !== undefined) {
      if (oracleAllows(record.oracle, intervention, record.facts.failedAt, simulatedNow)) {
        out.recovered = true
        out.recoveredPaise = record.facts.amountPaise
        break
      }
    }
  }

  return out
}

export const BASELINE_DELAYS_MS = [
  1 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const

export function simulateBaseline(record: EvalRecord): RecordOutcome {
  const out = emptyOutcome()

  for (const delay of BASELINE_DELAYS_MS) {
    const at = new Date(record.facts.failedAt.getTime() + delay)
    out.chargeAttempts++
    out.steps++
    if (!record.oracle.retry_charge.succeeds) out.wastedChargeAttempts++

    if (oracleAllows(record.oracle, 'retry_charge', record.facts.failedAt, at)) {
      out.recovered = true
      out.recoveredPaise = record.facts.amountPaise
      break
    }
  }

  return out
}
