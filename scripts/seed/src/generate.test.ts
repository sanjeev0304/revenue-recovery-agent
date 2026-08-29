import { describe, expect, it } from 'vitest'
import { lookupReason } from '@revenue/core'
import { generateDataset, type GeneratedPayment } from './generate.js'
import { INSUFFICIENT_FUNDS_FLOOR_MS } from './recoverability.js'
import {
  AMOUNT_MAX_PAISE,
  AMOUNT_MIN_PAISE,
  CAUSE_SHARES,
  HOLDOUT_RECORDS,
  IST_OFFSET_MS,
  OPAQUE_REASONS,
  TOTAL_RECORDS,
} from './spec.js'

const SEED = 20260829
const dataset = generateDataset({ seed: SEED })
const { payments } = dataset

const of = (cause: string): GeneratedPayment[] => payments.filter((p) => p.trueCause === cause)
const masked = payments.filter((p) => p.masked)
const ALL_OPAQUE = new Set([...OPAQUE_REASONS.card, ...OPAQUE_REASONS.upi])

const istHour = (d: Date): number =>
  Math.floor(((d.getTime() + IST_OFFSET_MS) % 86_400_000) / 3_600_000)

describe('shape', () => {
  it('generates the specified totals', () => {
    expect(payments).toHaveLength(TOTAL_RECORDS)
    expect(payments.filter((p) => p.evalSplit === 'holdout')).toHaveLength(HOLDOUT_RECORDS)
  })

  it('is deterministic for a fixed seed', () => {
    expect(JSON.stringify(generateDataset({ seed: SEED }))).toBe(JSON.stringify(dataset))
  })

  it('differs for a different seed', () => {
    expect(JSON.stringify(generateDataset({ seed: SEED + 1 }))).not.toBe(JSON.stringify(dataset))
  })

  it('matches the declared cause distribution', () => {
    for (const [cause, share] of CAUSE_SHARES) {
      expect(of(cause).length).toBe(Math.round(share * TOTAL_RECORDS))
    }
  })

  it('holds the method mix near 65% UPI', () => {
    const upi = payments.filter((p) => p.method === 'upi').length / payments.length
    expect(upi).toBeGreaterThan(0.6)
    expect(upi).toBeLessThan(0.7)
  })
})

describe('RISK_DECLINE recovers under nothing', () => {
  it('has no successful intervention on any record', () => {
    const risk = of('RISK_DECLINE')
    expect(risk.length).toBeGreaterThan(0)
    for (const p of risk) {
      expect(p.recoverableUnder.retry_charge).toEqual({ succeeds: false, afterMs: null })
      expect(p.recoverableUnder.issue_payment_link).toEqual({ succeeds: false, afterMs: null })
      expect(p.recoverableUnder.send_nudge).toEqual({ succeeds: false, afterMs: null })
    }
  })

  it('is never masked', () => {
    for (const p of of('RISK_DECLINE')) {
      expect(p.masked).toBe(false)
      expect(ALL_OPAQUE.has(p.errorReason)).toBe(false)
      expect(p.errorReason).toBe('payment_risk_check_failed')
    }
  })
})

describe('TECHNICAL_UNRESOLVED recovers under nothing', () => {
  it('has no successful intervention', () => {
    for (const p of of('TECHNICAL_UNRESOLVED')) {
      expect(p.recoverableUnder.retry_charge.succeeds).toBe(false)
      expect(p.recoverableUnder.issue_payment_link.succeeds).toBe(false)
      expect(p.recoverableUnder.send_nudge.succeeds).toBe(false)
    }
  })
})

describe('INSUFFICIENT_FUNDS never recovers on a short retry', () => {
  it('has no successful retry earlier than 18h', () => {
    const funds = of('INSUFFICIENT_FUNDS')
    expect(funds.length).toBeGreaterThan(0)

    const successes = funds
      .map((p) => p.recoverableUnder.retry_charge)
      .filter((o) => o.succeeds)
    expect(successes.length).toBeGreaterThan(0)

    for (const o of successes) {
      expect(o.afterMs).not.toBeNull()
      expect(o.afterMs!).toBeGreaterThanOrEqual(INSUFFICIENT_FUNDS_FLOOR_MS)
    }
  })

  it('never recovers under any intervention before the funds floor', () => {
    for (const p of of('INSUFFICIENT_FUNDS')) {
      for (const o of Object.values(p.recoverableUnder)) {
        if (o.succeeds) expect(o.afterMs!).toBeGreaterThanOrEqual(INSUFFICIENT_FUNDS_FLOOR_MS)
      }
    }
  })

  it('clusters before payday', () => {
    const days = of('INSUFFICIENT_FUNDS').map((p) =>
      new Date(p.failedAt.getTime() + IST_OFFSET_MS).getUTCDate(),
    )
    const late = days.filter((d) => d >= 22).length / days.length
    const early = days.filter((d) => d <= 7).length / days.length
    expect(late).toBeGreaterThan(0.45)
    expect(early).toBeLessThan(0.15)
  })
})

describe('masking leaks nothing', () => {
  it('produces masked records', () => {
    expect(masked.length).toBeGreaterThan(150)
    expect(masked.length).toBeLessThan(250)
  })

  it('always carries an opaque reason valid for the method', () => {
    for (const p of masked) {
      expect(OPAQUE_REASONS[p.method]).toContain(p.errorReason)
    }
  })

  it('never retains a customer source, which only unmasked causes have', () => {
    for (const p of masked) {
      expect(p.errorSource).not.toBe('customer')
    }
  })

  it('draws source and step only from the opaque distribution', () => {
    for (const p of masked) {
      expect(['bank', 'gateway', 'razorpay']).toContain(p.errorSource)
      expect([
        'payment_authorization',
        'payment_authentication',
        'payment_initiation',
      ]).toContain(p.errorStep)
    }
  })

  it('keeps the true cause on masked records', () => {
    const maskedNonOpaque = masked.filter((p) => p.trueCause !== 'OPAQUE_BANK_DECLINE')
    expect(maskedNonOpaque.length).toBe(masked.length)
  })

  it('makes the opaque pool about 29% with a 55% majority class', () => {
    const pool = payments.filter((p) => ALL_OPAQUE.has(p.errorReason))
    expect(pool.length / payments.length).toBeGreaterThan(0.26)
    expect(pool.length / payments.length).toBeLessThan(0.32)

    const majority = pool.filter((p) => p.trueCause === 'OPAQUE_BANK_DECLINE').length / pool.length
    expect(majority).toBeGreaterThan(0.5)
    expect(majority).toBeLessThan(0.6)
  })
})

describe('reason and method validity', () => {
  it('never emits a reason invalid for its method', () => {
    for (const p of payments) {
      const mapping = lookupReason(p.errorReason)
      expect(mapping).toBeDefined()
      expect(mapping!.methods).toContain(p.method)
    }
  })

  it('maps every unmasked reason back to its own true cause', () => {
    for (const p of payments.filter((x) => !x.masked)) {
      expect(lookupReason(p.errorReason)!.rootCause).toBe(p.trueCause)
    }
  })
})

describe('TRANSACTION_LIMIT_EXCEEDED splits internally', () => {
  const tle = of('TRANSACTION_LIMIT_EXCEEDED')

  it('splits roughly 70/30 daily to per-transaction', () => {
    const perTxn = tle.filter((p) => p.subtype === 'per_txn_cap').length / tle.length
    expect(perTxn).toBeGreaterThan(0.15)
    expect(perTxn).toBeLessThan(0.45)
  })

  it('recovers every daily-cap record on a retry, and no per-transaction record', () => {
    for (const p of tle) {
      if (p.subtype === 'daily_cap') {
        expect(p.recoverableUnder.retry_charge.succeeds).toBe(true)
      } else {
        expect(p.recoverableUnder.retry_charge.succeeds).toBe(false)
        expect(p.recoverableUnder.retry_charge.afterMs).toBeNull()
      }
    }
  })

  it('clusters per-transaction amounts just above a round cap', () => {
    for (const p of tle.filter((x) => x.subtype === 'per_txn_cap')) {
      const aboveOneLakh = p.amountPaise > 10_000_000 && p.amountPaise <= 11_500_000
      const aboveTwoLakh = p.amountPaise > 20_000_000 && p.amountPaise <= 23_000_000
      expect(aboveOneLakh || aboveTwoLakh).toBe(true)
    }
  })
})

describe('downtime incidents', () => {
  it('groups downtime records into bursts', () => {
    const incidents = new Map<string, GeneratedPayment[]>()
    for (const p of payments) {
      if (p.incidentId === null) continue
      incidents.set(p.incidentId, [...(incidents.get(p.incidentId) ?? []), p])
    }
    expect(incidents.size).toBeGreaterThan(15)

    for (const [, group] of incidents) {
      const times = group.map((p) => p.failedAt.getTime())
      expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(45 * 60_000)
    }
  })

  it('never splits an incident across the train and holdout boundary', () => {
    const splits = new Map<string, Set<string>>()
    for (const p of payments) {
      if (p.incidentId === null) continue
      const set = splits.get(p.incidentId) ?? new Set<string>()
      set.add(p.evalSplit)
      splits.set(p.incidentId, set)
    }
    for (const [, set] of splits) {
      expect(set.size).toBe(1)
    }
  })

  it('gives non-downtime records no incident id', () => {
    for (const p of payments) {
      if (p.trueCause !== 'ISSUER_DOWNTIME' && p.trueCause !== 'GATEWAY_DOWNTIME') {
        expect(p.incidentId).toBeNull()
      }
    }
  })
})

describe('amounts', () => {
  it('stays within the truncation bounds and is always an integer', () => {
    for (const p of payments) {
      expect(Number.isInteger(p.amountPaise)).toBe(true)
      expect(p.amountPaise).toBeGreaterThanOrEqual(AMOUNT_MIN_PAISE)
      expect(p.amountPaise).toBeLessThanOrEqual(AMOUNT_MAX_PAISE)
    }
  })

  it('keeps downtime amounts indistinguishable from the base distribution', () => {
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
    const issuer = median(of('ISSUER_DOWNTIME').map((p) => p.amountPaise))
    const gateway = median(of('GATEWAY_DOWNTIME').map((p) => p.amountPaise))
    const funds = median(of('INSUFFICIENT_FUNDS').map((p) => p.amountPaise))

    expect(Math.abs(issuer - gateway) / issuer).toBeLessThan(0.35)
    expect(funds).toBeGreaterThan(issuer * 1.5)
  })
})

describe('hour skew', () => {
  it('pushes AUTH_FAILED into the late-night window', () => {
    const share =
      of('AUTH_FAILED').filter((p) => [22, 23, 0, 1].includes(istHour(p.failedAt))).length /
      of('AUTH_FAILED').length
    expect(share).toBeGreaterThan(0.25)
  })

  it('leaves OPAQUE_BANK_DECLINE on the base curve', () => {
    const share =
      of('OPAQUE_BANK_DECLINE').filter((p) => [22, 23, 0, 1].includes(istHour(p.failedAt)))
        .length / of('OPAQUE_BANK_DECLINE').length
    expect(share).toBeLessThan(0.22)
  })
})

describe('prior attempts', () => {
  it('separates INSTRUMENT_INVALID from CUSTOMER_ABANDONED on attempt count', () => {
    const mean = (xs: GeneratedPayment[]) =>
      xs.reduce((a, p) => a + (p.attemptNumber - 1), 0) / xs.length
    expect(mean(of('INSTRUMENT_INVALID'))).toBeGreaterThan(mean(of('CUSTOMER_ABANDONED')) + 0.6)
  })
})
