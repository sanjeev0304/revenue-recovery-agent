import { describe, expect, it } from 'vitest'
import { applyLlmDiagnosis, classify, type PaymentFacts } from '@revenue/core'
import { RealClock, WarpedClock, type Clock } from '../clock.js'
import {
  handleRecoveryJob,
  type DecisionContext,
  type OrchestratorDeps,
  type ScheduleRequest,
} from './handler.js'

const HOUR = 3_600_000
const FAILED_AT = new Date('2026-07-14T06:30:00Z')
const IST = 'Asia/Kolkata'

function facts(reason: string, paymentId: string): PaymentFacts {
  return {
    paymentId,
    customerId: 'cust_1',
    amountPaise: 250_000,
    method: 'upi',
    failure: {
      code: 'BAD_REQUEST_ERROR',
      description: null,
      source: 'bank',
      step: 'payment_authorization',
      reason,
    },
    failedAt: FAILED_AT,
    attemptNumber: 1,
  }
}

function context(reason: string, paymentId: string, completedSteps: number): DecisionContext {
  const payment = facts(reason, paymentId)
  const resolved = classify(payment)
  const diagnosis =
    resolved.kind === 'resolved'
      ? resolved.diagnosis
      : applyLlmDiagnosis(resolved, {
          rootCause: 'OPAQUE_BANK_DECLINE',
          confidence: 0.8,
          reasoning: 'fixed for test',
        })

  return {
    payment,
    customer: { customerId: 'cust_1', timezone: IST, optedOut: false },
    diagnosis,
    history: {
      chargeAttempts: completedSteps,
      lastChargeAttemptAt: completedSteps > 0 ? FAILED_AT : null,
      contactsForPayment: 0,
      contactsForCustomerLast7d: 0,
      completedSteps,
      lastActionAt: completedSteps > 0 ? FAILED_AT : null,
      usedIdempotencyKeys: new Set<string>(),
    },
  }
}

interface Recorded {
  decisions: Array<{
    paymentId: string
    rootCause: string
    action: string | null
    allowed: boolean
    vetoedBy: string | null
    scheduledFor: string | null
    occurredAt: string
    evidence: string[]
  }>
  schedules: ScheduleRequest[]
}

function depsFor(clock: Clock, contexts: Map<string, DecisionContext>) {
  const recorded: Recorded = { decisions: [], schedules: [] }

  const deps: OrchestratorDeps = {
    clock,
    loadContext: async (id) => contexts.get(id) ?? null,
    persistDecision: async ({ decision, occurredAt }) => {
      recorded.decisions.push({
        paymentId: decision.paymentId,
        rootCause: decision.rootCause,
        action: decision.proposedAction?.type ?? null,
        allowed: decision.guardrailVerdict.allowed,
        vetoedBy: decision.guardrailVerdict.allowed
          ? null
          : decision.guardrailVerdict.vetoedBy,
        scheduledFor: decision.scheduledFor?.toISOString() ?? null,
        occurredAt: occurredAt.toISOString(),
        evidence: decision.evidence,
      })
    },
    schedule: async (request) => {
      recorded.schedules.push(request)
    },
  }

  return { deps, recorded }
}

const CASES: Array<[string, string, number]> = [
  ['insufficient_funds', 'pay_funds', 0],
  ['insufficient_funds', 'pay_funds_step2', 1],
  ['payment_risk_check_failed', 'pay_risk', 0],
  ['bank_technical_error', 'pay_issuer', 0],
  ['gateway_technical_error', 'pay_gateway', 0],
  ['card_expired', 'pay_instrument', 0],
  ['payment_cancelled', 'pay_abandoned', 1],
  ['transaction_limit_exceeded', 'pay_tle', 0],
  ['vpa_resolution_failed', 'pay_technical', 0],
]

function buildContexts(): Map<string, DecisionContext> {
  const map = new Map<string, DecisionContext>()
  for (const [reason, id, steps] of CASES) {
    const ctx = context(reason, id, steps)
    map.set(id, ctx.payment.method === 'card' ? ctx : ctx)
  }
  return map
}

function movableSource() {
  let realMs = 0
  return {
    source: () => realMs,
    set: (value: number) => {
      realMs = value
    },
  }
}

async function runAll(
  clock: Clock,
  advanceTo: (simulatedMs: number) => void,
  instants: readonly number[],
): Promise<Recorded> {
  const { deps, recorded } = depsFor(clock, buildContexts())
  for (let i = 0; i < CASES.length; i++) {
    advanceTo(instants[i]!)
    await handleRecoveryJob(deps, { paymentAttemptId: CASES[i]![1] })
  }
  return recorded
}

const INSTANTS = CASES.map((_, i) => FAILED_AT.getTime() + (i + 1) * 6 * HOUR)

async function realRun(): Promise<Recorded> {
  const m = movableSource()
  m.set(FAILED_AT.getTime())
  const clock = new RealClock(m.source)
  return runAll(clock, (simulated) => m.set(simulated), INSTANTS)
}

async function warpedRun(factor: number): Promise<Recorded> {
  const m = movableSource()
  const warpStart = 1_000_000
  m.set(warpStart)
  const clock = new WarpedClock(FAILED_AT, factor, m.source)
  return runAll(
    clock,
    (simulated) => m.set(warpStart + (simulated - FAILED_AT.getTime()) / factor),
    INSTANTS,
  )
}

describe('a warped run and a real run produce identical decisions', () => {
  it('produces the same simulated timestamps', async () => {
    const real = await realRun()
    const warped = await warpedRun(3600)

    expect(real.decisions.map((d) => d.occurredAt)).toEqual(
      INSTANTS.map((t) => new Date(t).toISOString()),
    )
    expect(warped.decisions.map((d) => d.occurredAt)).toEqual(
      real.decisions.map((d) => d.occurredAt),
    )
  })

  it('matches decision for decision across the taxonomy, evidence included', async () => {
    const real = await realRun()
    const warped = await warpedRun(3600)

    expect(warped.decisions).toHaveLength(CASES.length)
    expect(warped.decisions).toEqual(real.decisions)
  })

  it('holds at any warp factor, with delays scaling and nothing else changing', async () => {
    const real = await realRun()

    for (const factor of [1, 60, 3600]) {
      const warped = await warpedRun(factor)

      expect(warped.decisions).toEqual(real.decisions)
      expect(warped.schedules.map((s) => [s.runAt, s.idempotencyKey])).toEqual(
        real.schedules.map((s) => [s.runAt, s.idempotencyKey]),
      )
      for (let i = 0; i < real.schedules.length; i++) {
        expect(warped.schedules[i]!.delayMs).toBe(
          Math.round(real.schedules[i]!.delayMs / factor),
        )
      }
    }
  })

  it('schedules the same runAt and idempotency key, with a compressed delay', async () => {
    const real = await realRun()
    const warped = await warpedRun(3600)

    expect(warped.schedules.map((s) => [s.runAt, s.idempotencyKey])).toEqual(
      real.schedules.map((s) => [s.runAt, s.idempotencyKey]),
    )

    for (let i = 0; i < real.schedules.length; i++) {
      expect(warped.schedules[i]!.delayMs).toBe(Math.round(real.schedules[i]!.delayMs / 3600))
    }
    expect(real.schedules.length).toBeGreaterThan(0)
  })

  it('compresses a 24h wait into 24 real seconds', async () => {
    const at = FAILED_AT.getTime()

    const realDeps = depsFor(new RealClock(() => at), buildContexts())
    await handleRecoveryJob(realDeps.deps, { paymentAttemptId: 'pay_funds' })

    const warpedDeps = depsFor(new WarpedClock(new Date(at), 3600, () => 0), buildContexts())
    await handleRecoveryJob(warpedDeps.deps, { paymentAttemptId: 'pay_funds' })

    expect(realDeps.recorded.schedules[0]!.delayMs).toBe(24 * HOUR)
    expect(warpedDeps.recorded.schedules[0]!.delayMs).toBe(24_000)
    expect(warpedDeps.recorded.schedules[0]!.runAt).toEqual(
      realDeps.recorded.schedules[0]!.runAt,
    )
  })
})

describe('handleRecoveryJob', () => {
  it('reads the clock once, so a moving clock cannot split a single decision', async () => {
    let calls = 0
    const moving = new RealClock(() => {
      calls++
      return FAILED_AT.getTime() + calls * 10 * HOUR
    })

    const { deps, recorded } = depsFor(moving, buildContexts())
    await handleRecoveryJob(deps, { paymentAttemptId: 'pay_risk' })

    expect(calls).toBe(1)
    expect(recorded.decisions[0]!.occurredAt).toBe(
      new Date(FAILED_AT.getTime() + 10 * HOUR).toISOString(),
    )
  })

  it('returns unknown_payment without persisting anything', async () => {
    const { deps, recorded } = depsFor(new RealClock(() => 0), buildContexts())
    const result = await handleRecoveryJob(deps, { paymentAttemptId: 'pay_missing' })

    expect(result).toEqual({ status: 'unknown_payment' })
    expect(recorded.decisions).toHaveLength(0)
    expect(recorded.schedules).toHaveLength(0)
  })

  it('persists a vetoed decision but schedules nothing', async () => {
    const contexts = buildContexts()
    const ctx = contexts.get('pay_abandoned')!
    contexts.set('pay_abandoned', {
      ...ctx,
      customer: { ...ctx.customer, optedOut: true },
    })

    const { deps, recorded } = depsFor(new RealClock(() => FAILED_AT.getTime()), contexts)
    await handleRecoveryJob(deps, { paymentAttemptId: 'pay_abandoned' })

    expect(recorded.decisions).toHaveLength(1)
    expect(recorded.decisions[0]!.allowed).toBe(false)
    expect(recorded.schedules).toHaveLength(0)
  })

  it('persists an escalation without scheduling a follow-up', async () => {
    const { deps, recorded } = depsFor(new RealClock(() => FAILED_AT.getTime()), buildContexts())
    const result = await handleRecoveryJob(deps, { paymentAttemptId: 'pay_risk' })

    expect(result.status).toBe('decided')
    if (result.status === 'decided') {
      expect(result.decision.proposedAction?.type).toBe('escalate')
      expect(result.scheduled).toBeNull()
    }
    expect(recorded.decisions).toHaveLength(1)
  })

  it('records which clock produced the decision', async () => {
    const seen: string[] = []
    const contexts = buildContexts()
    const deps: OrchestratorDeps = {
      clock: new WarpedClock(FAILED_AT, 3600, () => 0),
      loadContext: async (id) => contexts.get(id) ?? null,
      persistDecision: async ({ clockKind }) => {
        seen.push(clockKind)
      },
      schedule: async () => {},
    }
    await handleRecoveryJob(deps, { paymentAttemptId: 'pay_funds' })
    expect(seen).toEqual(['warped'])
  })
})

describe('decision independence', () => {
  it('derives scheduledFor from failedAt, not from the clock', async () => {
    const early = depsFor(new RealClock(() => FAILED_AT.getTime()), buildContexts())
    await handleRecoveryJob(early.deps, { paymentAttemptId: 'pay_funds' })

    const late = depsFor(
      new RealClock(() => FAILED_AT.getTime() + 500 * HOUR),
      buildContexts(),
    )
    await handleRecoveryJob(late.deps, { paymentAttemptId: 'pay_funds' })

    const a = early.recorded.decisions[0]!
    const b = late.recorded.decisions[0]!
    expect(a.scheduledFor).toBe(b.scheduledFor)
    expect(a.scheduledFor).not.toBeNull()
    expect(a.occurredAt).not.toBe(b.occurredAt)
  })
})
