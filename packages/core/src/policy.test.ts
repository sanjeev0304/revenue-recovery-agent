import { describe, expect, it } from 'vitest'
import { decide, resolvePlaybook, type PolicyInput } from './policy.js'
import { classify, applyLlmDiagnosis } from './diagnosis.js'
import { DAY_MS, HOUR_MS, localHour } from './time.js'
import { evaluateGuardrails } from './guardrails.js'
import { PLAYBOOKS } from './playbooks.js'
import type { Diagnosis, PaymentFacts } from './types.js'

const IST = 'Asia/Kolkata'
const FAILED_AT = new Date('2026-09-10T06:30:00Z')

function facts(over: Partial<PaymentFacts> & { reason?: string | null } = {}): PaymentFacts {
  return {
    paymentId: over.paymentId ?? 'pay_1',
    customerId: 'cust_1',
    amountPaise: over.amountPaise ?? 250_000,
    method: over.method ?? 'upi',
    failure: {
      code: 'BAD_REQUEST_ERROR',
      description: null,
      source: 'bank',
      step: 'payment_authorization',
      reason: over.reason === undefined ? 'insufficient_funds' : over.reason,
    },
    failedAt: over.failedAt ?? FAILED_AT,
    attemptNumber: over.attemptNumber ?? 1,
  }
}

function input(over: {
  payment?: PaymentFacts
  diagnosis?: Diagnosis
  completedSteps?: number
  chargeAttempts?: number
  contactsForPayment?: number
  lastActionAt?: Date | null
  lastChargeAttemptAt?: Date | null
  optedOut?: boolean
  now?: Date
} = {}): PolicyInput {
  const payment = over.payment ?? facts()
  const resolved = classify(payment)
  const diagnosis =
    over.diagnosis ??
    (resolved.kind === 'resolved'
      ? resolved.diagnosis
      : applyLlmDiagnosis(resolved, {
          rootCause: 'OPAQUE_BANK_DECLINE',
          confidence: 0.8,
          reasoning: 'test',
        }))

  return {
    payment,
    customer: { customerId: 'cust_1', timezone: IST, optedOut: over.optedOut ?? false },
    diagnosis,
    history: {
      chargeAttempts: over.chargeAttempts ?? 0,
      lastChargeAttemptAt: over.lastChargeAttemptAt ?? null,
      contactsForPayment: over.contactsForPayment ?? 0,
      contactsForCustomerLast7d: 0,
      completedSteps: over.completedSteps ?? 0,
      lastActionAt: over.lastActionAt ?? null,
      usedIdempotencyKeys: new Set(),
    },
    now: over.now ?? FAILED_AT,
  }
}

describe('INSUFFICIENT_FUNDS', () => {
  it('never proposes an immediate retry', () => {
    const d = decide(input())
    expect(d.rootCause).toBe('INSUFFICIENT_FUNDS')
    expect(d.proposedAction?.type).toBe('retry_charge')
    const delay = d.scheduledFor!.getTime() - FAILED_AT.getTime()
    expect(delay).toBe(24 * HOUR_MS)
  })

  it('shifts the second retry to the salary window when one is near', () => {
    const lastAction = new Date('2026-08-28T06:30:00Z')
    const d = decide(
      input({ completedSteps: 1, chargeAttempts: 1, lastActionAt: lastAction, now: lastAction }),
    )
    const daysOut = (d.scheduledFor!.getTime() - lastAction.getTime()) / DAY_MS
    expect(daysOut).toBeLessThan(5)
    expect(localHour(d.scheduledFor!, IST)).toBe(10)
  })

  it('falls back to +48h when no salary window is near', () => {
    const lastAction = new Date('2026-09-05T06:30:00Z')
    const d = decide(
      input({ completedSteps: 1, chargeAttempts: 1, lastActionAt: lastAction, now: lastAction }),
    )
    expect(d.scheduledFor!.getTime() - lastAction.getTime()).toBe(48 * HOUR_MS)
  })

  it('lands the nudge four days after failure when walked step by step', () => {
    const first = decide(input())
    expect(first.proposedAction?.type).toBe('retry_charge')
    const t1 = first.scheduledFor!

    const second = decide(
      input({ completedSteps: 1, chargeAttempts: 1, lastActionAt: t1, lastChargeAttemptAt: t1, now: t1 }),
    )
    expect(second.proposedAction?.type).toBe('retry_charge')
    const t2 = second.scheduledFor!

    const third = decide(
      input({ completedSteps: 2, chargeAttempts: 2, lastActionAt: t2, lastChargeAttemptAt: t2, now: t2 }),
    )
    expect(third.proposedAction?.type).toBe('send_nudge')
    expect(third.guardrailVerdict.allowed).toBe(true)

    expect(third.scheduledFor!.getTime() - t2.getTime()).toBe(24 * HOUR_MS)
    expect((t1.getTime() - FAILED_AT.getTime()) / DAY_MS).toBe(1)
    expect((t2.getTime() - FAILED_AT.getTime()) / DAY_MS).toBe(3)
    expect((third.scheduledFor!.getTime() - FAILED_AT.getTime()) / DAY_MS).toBe(4)
  })

  it('stops rather than escalating once the playbook is exhausted', () => {
    const d = decide(input({ completedSteps: 3, chargeAttempts: 2, contactsForPayment: 1 }))
    expect(d.proposedAction).toBeNull()
    expect(d.guardrailVerdict.allowed).toBe(true)
  })
})

describe('RISK_DECLINE', () => {
  const risk = facts({ reason: 'payment_risk_check_failed' })

  it('escalates immediately and never proposes a charge', () => {
    const d = decide(input({ payment: risk }))
    expect(d.rootCause).toBe('RISK_DECLINE')
    expect(d.proposedAction?.type).toBe('escalate')
    expect(d.guardrailVerdict.allowed).toBe(true)
  })

  it('is blocked by guardrails even if a charge is somehow proposed', () => {
    const d = decide(input({ payment: risk, completedSteps: 0 }))
    expect(d.proposedAction?.type).not.toBe('retry_charge')
  })
})

describe('TRANSACTION_LIMIT_EXCEEDED', () => {
  const tle = facts({ reason: 'transaction_limit_exceeded' })

  it('schedules the retry after the next local midnight, never same day', () => {
    const d = decide(input({ payment: tle }))
    expect(d.rootCause).toBe('TRANSACTION_LIMIT_EXCEEDED')
    expect(d.proposedAction?.type).toBe('retry_charge')
    expect(localHour(d.scheduledFor!, IST)).toBe(1)
    expect(d.scheduledFor!.getTime()).toBeGreaterThan(FAILED_AT.getTime())
  })

  it('allows only one retry, then contacts', () => {
    const d = decide(input({ payment: tle, completedSteps: 1, chargeAttempts: 1 }))
    expect(d.proposedAction?.type).toBe('send_nudge')
  })

  it('nudges 12h after the failed retry', () => {
    const retryAt = new Date('2026-09-11T02:00:00Z')
    const d = decide(
      input({
        payment: tle,
        completedSteps: 1,
        chargeAttempts: 1,
        lastActionAt: retryAt,
        now: retryAt,
      }),
    )
    expect(d.scheduledFor!.getTime() - retryAt.getTime()).toBe(12 * HOUR_MS)
  })
})

describe('AUTH_FAILED', () => {
  const auth = facts({ reason: 'authentication_failed' })

  it('issues a link first, without any charge retry', () => {
    const d = decide(input({ payment: auth }))
    expect(d.rootCause).toBe('AUTH_FAILED')
    expect(d.proposedAction?.type).toBe('issue_payment_link')
  })

  it('waits 2h before nudging, not minutes', () => {
    const linkAt = new Date('2026-09-10T06:30:00Z')
    const d = decide(
      input({ payment: auth, completedSteps: 1, lastActionAt: linkAt, now: linkAt }),
    )
    expect(d.proposedAction?.type).toBe('send_nudge')
    expect(d.scheduledFor!.getTime() - linkAt.getTime()).toBe(2 * HOUR_MS)
  })
})

describe('INSTRUMENT_INVALID', () => {
  const dead = facts({ reason: 'card_expired', method: 'card' })

  it('issues a link rather than retrying a card that cannot work', () => {
    const d = decide(input({ payment: dead }))
    expect(d.rootCause).toBe('INSTRUMENT_INVALID')
    expect(d.proposedAction?.type).toBe('issue_payment_link')
  })

  it('waits 1h before nudging, not minutes', () => {
    const linkAt = new Date('2026-09-10T06:30:00Z')
    const d = decide(
      input({ payment: dead, completedSteps: 1, lastActionAt: linkAt, now: linkAt }),
    )
    expect(d.proposedAction?.type).toBe('send_nudge')
    expect(d.scheduledFor!.getTime() - linkAt.getTime()).toBe(HOUR_MS)
  })
})

describe('quiet hours interaction', () => {
  it('defers a nudge that would land at 02:00 local instead of killing it', () => {
    const abandonedAt = new Date('2026-09-10T18:35:00Z')
    const payment = facts({ reason: 'payment_cancelled', failedAt: abandonedAt })
    const d = decide(
      input({ payment, completedSteps: 1, lastActionAt: abandonedAt, now: abandonedAt }),
    )

    expect(d.proposedAction?.type).toBe('send_nudge')
    expect(d.guardrailVerdict.allowed).toBe(true)
    expect(d.scheduledFor).not.toBeNull()
    expect(localHour(d.scheduledFor!, IST)).toBe(9)
    expect(d.proposedAction?.payload['deferredBy']).toBe('QUIET_HOURS')
    expect(d.evidence.some((e) => e.includes('deferred to'))).toBe(true)
  })

  it('leaves a daytime nudge exactly where the playbook put it', () => {
    const failedAt = new Date('2026-09-10T04:00:00Z')
    const payment = facts({ reason: 'payment_cancelled', failedAt })
    const d = decide(input({ payment, completedSteps: 1, lastActionAt: failedAt, now: failedAt }))

    expect(d.scheduledFor!.getTime()).toBe(failedAt.getTime() + 2 * HOUR_MS)
    expect(d.proposedAction?.payload['deferredBy']).toBeUndefined()
  })

  it('never proposes a nudge inside quiet hours, at any failure hour', () => {
    for (let h = 0; h < 24; h++) {
      const failedAt = new Date(Date.UTC(2026, 8, 10, h, 5))
      const payment = facts({ reason: 'payment_cancelled', failedAt })
      const d = decide(
        input({ payment, completedSteps: 1, lastActionAt: failedAt, now: failedAt }),
      )
      if (d.proposedAction?.type !== 'send_nudge') continue
      const hour = localHour(d.scheduledFor!, IST)
      expect(hour).toBeGreaterThanOrEqual(9)
      expect(hour).toBeLessThan(21)
      expect(d.guardrailVerdict.allowed).toBe(true)
    }
  })

  it('leaves the QUIET_HOURS guardrail in place as a backstop', () => {
    const at = new Date('2026-09-10T18:35:00Z')
    const payment = facts({ reason: 'payment_cancelled', failedAt: at })
    const ctx = input({ payment, completedSteps: 1, lastActionAt: at, now: at })
    const d = decide(ctx)

    const forced = evaluateGuardrails({
      payment: ctx.payment,
      customer: ctx.customer,
      history: ctx.history,
      rootCause: d.rootCause,
      playbook: PLAYBOOKS[d.rootCause],
      action: { ...d.proposedAction!, scheduledFor: at },
      now: at,
    })
    expect(forced).toMatchObject({ allowed: false, vetoedBy: 'QUIET_HOURS' })
  })
})

describe('unmapped reasons', () => {
  const weird = facts({ reason: 'some_new_reason_razorpay_added' })

  it('halves caps when the LLM resolves an unmapped reason', () => {
    const resolved = classify(weird)
    expect(resolved.kind).toBe('needs_llm')
    const diagnosis = applyLlmDiagnosis(resolved as never, {
      rootCause: 'ISSUER_DOWNTIME',
      confidence: 0.9,
      reasoning: 'looks like bank downtime',
    })
    const { playbook, capsHalved } = resolvePlaybook(weird, diagnosis)
    expect(capsHalved).toBe(true)
    expect(playbook.maxRetries).toBe(1)
  })

  it('escalates without acting below the confidence floor', () => {
    const resolved = classify(weird)
    const diagnosis = applyLlmDiagnosis(resolved as never, {
      rootCause: 'ISSUER_DOWNTIME',
      confidence: 0.4,
      reasoning: 'not sure',
    })
    const d = decide(input({ payment: weird, diagnosis }))
    expect(d.proposedAction?.type).toBe('escalate')
    expect(d.evidence.some((e) => e.includes('below the 0.6 floor'))).toBe(true)
  })

  it('does not halve caps for a mapped reason', () => {
    const { capsHalved } = resolvePlaybook(facts(), {
      rootCause: 'INSUFFICIENT_FUNDS',
      confidence: 1,
      classifier: 'deterministic',
      evidence: [],
    })
    expect(capsHalved).toBe(false)
  })
})

describe('idempotency keys', () => {
  it('are deterministic for the same payment and step', () => {
    const a = decide(input()).proposedAction!.idempotencyKey
    const b = decide(input()).proposedAction!.idempotencyKey
    expect(a).toBe(b)
  })

  it('differ across steps', () => {
    const step0 = decide(input({ completedSteps: 0 })).proposedAction!.idempotencyKey
    const step1 = decide(
      input({ completedSteps: 1, chargeAttempts: 1, lastActionAt: FAILED_AT }),
    ).proposedAction!.idempotencyKey
    expect(step0).not.toBe(step1)
  })
})

describe('every decision is recorded', () => {
  it('produces a decision even when the action is vetoed', () => {
    const d = decide(input({ optedOut: true, payment: facts({ reason: 'payment_cancelled' }), completedSteps: 1, lastActionAt: FAILED_AT }))
    expect(d.paymentId).toBe('pay_1')
    expect(d.evidence.length).toBeGreaterThan(0)
    expect(d.guardrailVerdict.allowed).toBe(false)
  })

  it('carries the raw razorpay fields through for the audit trail', () => {
    const d = decide(input())
    expect(d.razorpayReason).toBe('insufficient_funds')
    expect(d.razorpaySource).toBe('bank')
    expect(d.razorpayStep).toBe('payment_authorization')
  })
})
