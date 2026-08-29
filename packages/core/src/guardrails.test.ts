import { describe, expect, it } from 'vitest'
import { evaluateGuardrails, type GuardrailContext } from './guardrails.js'
import { DEFAULT_AMOUNT_CEILING_PAISE, PLAYBOOKS } from './playbooks.js'
import { HOUR_MS } from './time.js'
import type { ActionType, RootCause } from './types.js'

const IST = 'Asia/Kolkata'
const NOON_IST = new Date('2026-09-01T06:30:00Z')

function ctx(overrides: {
  actionType?: ActionType
  rootCause?: RootCause
  scheduledFor?: Date | null
  amountPaise?: number
  optedOut?: boolean
  chargeAttempts?: number
  lastChargeAttemptAt?: Date | null
  contactsForPayment?: number
  contactsForCustomerLast7d?: number
  usedKeys?: string[]
  idempotencyKey?: string
  timezone?: string
  now?: Date
}): GuardrailContext {
  const rootCause = overrides.rootCause ?? 'OPAQUE_BANK_DECLINE'
  return {
    payment: {
      paymentId: 'pay_1',
      customerId: 'cust_1',
      amountPaise: overrides.amountPaise ?? 250_000,
      method: 'upi',
      failure: { code: null, description: null, source: null, step: null, reason: null },
      failedAt: NOON_IST,
      attemptNumber: 1,
    },
    customer: {
      customerId: 'cust_1',
      timezone: overrides.timezone ?? IST,
      optedOut: overrides.optedOut ?? false,
    },
    history: {
      chargeAttempts: overrides.chargeAttempts ?? 0,
      lastChargeAttemptAt: overrides.lastChargeAttemptAt ?? null,
      contactsForPayment: overrides.contactsForPayment ?? 0,
      contactsForCustomerLast7d: overrides.contactsForCustomerLast7d ?? 0,
      completedSteps: 0,
      lastActionAt: overrides.lastChargeAttemptAt ?? null,
      usedIdempotencyKeys: new Set(overrides.usedKeys ?? []),
    },
    rootCause,
    playbook: PLAYBOOKS[rootCause],
    action: {
      type: overrides.actionType ?? 'retry_charge',
      scheduledFor: overrides.scheduledFor === undefined ? null : overrides.scheduledFor,
      idempotencyKey: overrides.idempotencyKey ?? 'key_1',
      payload: {},
    },
    now: overrides.now ?? NOON_IST,
  }
}

describe('PERMANENT_FAILURE_BLOCK', () => {
  it.each(['RISK_DECLINE', 'INSTRUMENT_INVALID', 'TECHNICAL_UNRESOLVED'] as const)(
    'vetoes a charge retry for %s',
    (rootCause) => {
      const v = evaluateGuardrails(ctx({ rootCause, actionType: 'retry_charge' }))
      expect(v).toMatchObject({ allowed: false, vetoedBy: 'PERMANENT_FAILURE_BLOCK' })
    },
  )

  it('does not block a nudge for INSTRUMENT_INVALID', () => {
    const v = evaluateGuardrails(ctx({ rootCause: 'INSTRUMENT_INVALID', actionType: 'send_nudge' }))
    expect(v.allowed).toBe(true)
  })

  it('wins over GLOBAL_ATTEMPT_CAP when both would fire', () => {
    const v = evaluateGuardrails(
      ctx({ rootCause: 'RISK_DECLINE', actionType: 'retry_charge', chargeAttempts: 9 }),
    )
    expect(v).toMatchObject({ vetoedBy: 'PERMANENT_FAILURE_BLOCK' })
  })
})

describe('GLOBAL_ATTEMPT_CAP', () => {
  it('allows the third attempt and vetoes the fourth', () => {
    const at2 = evaluateGuardrails(
      ctx({ rootCause: 'ISSUER_DOWNTIME', chargeAttempts: 2, lastChargeAttemptAt: null }),
    )
    expect(at2.allowed).toBe(true)

    const at3 = evaluateGuardrails(
      ctx({ rootCause: 'ISSUER_DOWNTIME', chargeAttempts: 3, lastChargeAttemptAt: null }),
    )
    expect(at3).toMatchObject({ allowed: false, vetoedBy: 'GLOBAL_ATTEMPT_CAP' })
  })

  it('never applies to contact actions', () => {
    const v = evaluateGuardrails(
      ctx({ rootCause: 'CUSTOMER_ABANDONED', actionType: 'send_nudge', chargeAttempts: 99 }),
    )
    expect(v.allowed).toBe(true)
  })
})

describe('PLAYBOOK_ATTEMPT_CAP', () => {
  it('vetoes a second retry for OPAQUE_BANK_DECLINE, which allows one', () => {
    const v = evaluateGuardrails(
      ctx({ rootCause: 'OPAQUE_BANK_DECLINE', chargeAttempts: 1, lastChargeAttemptAt: null }),
    )
    expect(v).toMatchObject({ allowed: false, vetoedBy: 'PLAYBOOK_ATTEMPT_CAP' })
  })

  it('vetoes a third contact for CUSTOMER_ABANDONED, which allows two', () => {
    const v = evaluateGuardrails(
      ctx({
        rootCause: 'CUSTOMER_ABANDONED',
        actionType: 'send_nudge',
        contactsForPayment: 2,
      }),
    )
    expect(v).toMatchObject({ allowed: false, vetoedBy: 'PLAYBOOK_ATTEMPT_CAP' })
  })
})

describe('COOLDOWN', () => {
  it('measures against scheduledFor, not now', () => {
    const lastAttempt = new Date(NOON_IST.getTime() - HOUR_MS)

    const immediate = evaluateGuardrails(
      ctx({ rootCause: 'OPAQUE_BANK_DECLINE', lastChargeAttemptAt: lastAttempt }),
    )
    expect(immediate).toMatchObject({ allowed: false, vetoedBy: 'COOLDOWN' })

    const scheduled = evaluateGuardrails(
      ctx({
        rootCause: 'OPAQUE_BANK_DECLINE',
        lastChargeAttemptAt: lastAttempt,
        scheduledFor: new Date(NOON_IST.getTime() + 6 * HOUR_MS),
      }),
    )
    expect(scheduled.allowed).toBe(true)
  })

  it('treats the exact cooldown boundary as satisfied', () => {
    const last = new Date(NOON_IST.getTime() - 6 * HOUR_MS)
    const v = evaluateGuardrails(
      ctx({ rootCause: 'OPAQUE_BANK_DECLINE', lastChargeAttemptAt: last }),
    )
    expect(v.allowed).toBe(true)
  })

  it('does not apply when there is no prior attempt', () => {
    const v = evaluateGuardrails(
      ctx({ rootCause: 'OPAQUE_BANK_DECLINE', lastChargeAttemptAt: null }),
    )
    expect(v.allowed).toBe(true)
  })
})

describe('QUIET_HOURS', () => {
  const nudgeAt = (utc: string, timezone = IST) =>
    evaluateGuardrails(
      ctx({
        rootCause: 'CUSTOMER_ABANDONED',
        actionType: 'send_nudge',
        scheduledFor: new Date(utc),
        timezone,
      }),
    )

  it('allows 20:59 local and vetoes 21:00 local', () => {
    expect(nudgeAt('2026-09-01T15:29:00Z').allowed).toBe(true)
    expect(nudgeAt('2026-09-01T15:30:00Z')).toMatchObject({ vetoedBy: 'QUIET_HOURS' })
  })

  it('vetoes 08:59 local and allows 09:00 local', () => {
    expect(nudgeAt('2026-09-01T03:29:00Z')).toMatchObject({ vetoedBy: 'QUIET_HOURS' })
    expect(nudgeAt('2026-09-01T03:30:00Z').allowed).toBe(true)
  })

  it('vetoes across local midnight', () => {
    expect(nudgeAt('2026-09-01T18:30:00Z')).toMatchObject({ vetoedBy: 'QUIET_HOURS' })
  })

  it('is evaluated in the customer timezone, not UTC', () => {
    const utcMidday = '2026-09-01T12:00:00Z'
    expect(nudgeAt(utcMidday, 'UTC').allowed).toBe(true)
    expect(nudgeAt(utcMidday, 'Pacific/Auckland')).toMatchObject({ vetoedBy: 'QUIET_HOURS' })
  })

  it('never applies to a charge retry, which is silent', () => {
    const v = evaluateGuardrails(
      ctx({
        rootCause: 'ISSUER_DOWNTIME',
        actionType: 'retry_charge',
        scheduledFor: new Date('2026-09-01T20:00:00Z'),
      }),
    )
    expect(v.allowed).toBe(true)
  })
})

describe('CONTACT_CAP', () => {
  it('vetoes on the rolling 7 day customer cap even when the payment is clean', () => {
    const v = evaluateGuardrails(
      ctx({
        rootCause: 'CUSTOMER_ABANDONED',
        actionType: 'send_nudge',
        contactsForPayment: 0,
        contactsForCustomerLast7d: 3,
      }),
    )
    expect(v).toMatchObject({ allowed: false, vetoedBy: 'CONTACT_CAP' })
  })
})

describe('OPT_OUT', () => {
  it('vetoes contact', () => {
    const v = evaluateGuardrails(
      ctx({ rootCause: 'CUSTOMER_ABANDONED', actionType: 'send_nudge', optedOut: true }),
    )
    expect(v).toMatchObject({ allowed: false, vetoedBy: 'OPT_OUT' })
  })

  it('still allows a silent charge retry', () => {
    const v = evaluateGuardrails(
      ctx({ rootCause: 'ISSUER_DOWNTIME', actionType: 'retry_charge', optedOut: true }),
    )
    expect(v.allowed).toBe(true)
  })

  it('yields to CONTACT_CAP because it is ordered after it', () => {
    const v = evaluateGuardrails(
      ctx({
        rootCause: 'CUSTOMER_ABANDONED',
        actionType: 'send_nudge',
        optedOut: true,
        contactsForCustomerLast7d: 5,
      }),
    )
    expect(v).toMatchObject({ vetoedBy: 'CONTACT_CAP' })
  })
})

describe('IDEMPOTENCY', () => {
  it('vetoes a duplicate key', () => {
    const v = evaluateGuardrails(ctx({ idempotencyKey: 'dup', usedKeys: ['dup'] }))
    expect(v).toMatchObject({ allowed: false, vetoedBy: 'IDEMPOTENCY' })
  })

  it('applies to escalate as well as money actions', () => {
    const v = evaluateGuardrails(
      ctx({ actionType: 'escalate', idempotencyKey: 'dup', usedKeys: ['dup'] }),
    )
    expect(v).toMatchObject({ vetoedBy: 'IDEMPOTENCY' })
  })
})

describe('AMOUNT_CEILING', () => {
  it('allows exactly the ceiling and vetoes one paise above', () => {
    expect(
      evaluateGuardrails(
        ctx({ rootCause: 'ISSUER_DOWNTIME', amountPaise: DEFAULT_AMOUNT_CEILING_PAISE }),
      ).allowed,
    ).toBe(true)

    expect(
      evaluateGuardrails(
        ctx({ rootCause: 'ISSUER_DOWNTIME', amountPaise: DEFAULT_AMOUNT_CEILING_PAISE + 1 }),
      ),
    ).toMatchObject({ allowed: false, vetoedBy: 'AMOUNT_CEILING' })
  })

  it('does not cap a contact for a large amount', () => {
    const v = evaluateGuardrails(
      ctx({
        rootCause: 'CUSTOMER_ABANDONED',
        actionType: 'send_nudge',
        amountPaise: DEFAULT_AMOUNT_CEILING_PAISE * 10,
      }),
    )
    expect(v.allowed).toBe(true)
  })
})

describe('escalate', () => {
  it('is never vetoed by charge or contact rules', () => {
    const v = evaluateGuardrails(
      ctx({
        rootCause: 'RISK_DECLINE',
        actionType: 'escalate',
        chargeAttempts: 99,
        contactsForPayment: 99,
        optedOut: true,
        amountPaise: DEFAULT_AMOUNT_CEILING_PAISE * 100,
      }),
    )
    expect(v.allowed).toBe(true)
  })
})

describe('purity', () => {
  it('returns the same verdict for the same input', () => {
    const build = () => ctx({ rootCause: 'RISK_DECLINE' })
    expect(evaluateGuardrails(build())).toEqual(evaluateGuardrails(build()))
  })

  it('does not mutate the context it is given', () => {
    const c = ctx({ rootCause: 'RISK_DECLINE' })
    const snapshot = JSON.stringify({ ...c, history: { ...c.history, usedIdempotencyKeys: [] } })
    evaluateGuardrails(c)
    expect(JSON.stringify({ ...c, history: { ...c.history, usedIdempotencyKeys: [] } })).toBe(
      snapshot,
    )
  })
})
