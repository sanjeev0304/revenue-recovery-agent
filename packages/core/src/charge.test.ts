import { describe, expect, it } from 'vitest'
import {
  CONTACT_RESPONSE_HORIZON_MS,
  oracleAllows,
  recoverabilityOracleSchema,
  type RecoverabilityOracle,
} from './charge.js'
import { HOUR_MS } from './time.js'

const FAILED_AT = new Date('2026-09-10T00:00:00Z')

const oracle = (over: Partial<RecoverabilityOracle> = {}): RecoverabilityOracle => ({
  retry_charge: { succeeds: true, afterMs: 24 * HOUR_MS },
  issue_payment_link: { succeeds: false, afterMs: null },
  send_nudge: { succeeds: false, afterMs: null },
  ...over,
})

describe('oracleAllows', () => {
  it('is false before the delay has elapsed', () => {
    const at = new Date(FAILED_AT.getTime() + 23 * HOUR_MS)
    expect(oracleAllows(oracle(), 'retry_charge', FAILED_AT, at)).toBe(false)
  })

  it('is true exactly at the delay boundary', () => {
    const at = new Date(FAILED_AT.getTime() + 24 * HOUR_MS)
    expect(oracleAllows(oracle(), 'retry_charge', FAILED_AT, at)).toBe(true)
  })

  it('is false when the intervention never succeeds, at any time', () => {
    const far = new Date(FAILED_AT.getTime() + 400 * HOUR_MS)
    expect(oracleAllows(oracle(), 'send_nudge', FAILED_AT, far)).toBe(false)
  })

  it('lets a contact issued before the response window still succeed', () => {
    const o = oracle({ issue_payment_link: { succeeds: true, afterMs: 6 * HOUR_MS } })
    expect(oracleAllows(o, 'issue_payment_link', FAILED_AT, FAILED_AT)).toBe(true)
  })

  it('rejects a contact whose response window is beyond the horizon', () => {
    const o = oracle({ issue_payment_link: { succeeds: true, afterMs: 200 * HOUR_MS } })
    expect(oracleAllows(o, 'issue_payment_link', FAILED_AT, FAILED_AT)).toBe(false)
  })

  it('honours the horizon boundary exactly for a contact', () => {
    const o = oracle({ send_nudge: { succeeds: true, afterMs: CONTACT_RESPONSE_HORIZON_MS } })
    expect(oracleAllows(o, 'send_nudge', FAILED_AT, FAILED_AT)).toBe(true)

    const beyond = oracle({
      send_nudge: { succeeds: true, afterMs: CONTACT_RESPONSE_HORIZON_MS + 1 },
    })
    expect(oracleAllows(beyond, 'send_nudge', FAILED_AT, FAILED_AT)).toBe(false)
  })

  it('lets a later contact reach a window that had already opened', () => {
    const o = oracle({ send_nudge: { succeeds: true, afterMs: 2 * HOUR_MS } })
    const late = new Date(FAILED_AT.getTime() + 50 * HOUR_MS)
    expect(oracleAllows(o, 'send_nudge', FAILED_AT, late)).toBe(true)
  })

  it('keeps the strict too-early rule for a charge', () => {
    const o = oracle({ retry_charge: { succeeds: true, afterMs: 24 * HOUR_MS } })
    expect(oracleAllows(o, 'retry_charge', FAILED_AT, FAILED_AT)).toBe(false)
    expect(
      oracleAllows(o, 'retry_charge', FAILED_AT, new Date(FAILED_AT.getTime() + 24 * HOUR_MS)),
    ).toBe(true)
  })

  it('is false when succeeds is true but afterMs is null', () => {
    const o = oracle({ retry_charge: { succeeds: true, afterMs: null } })
    const far = new Date(FAILED_AT.getTime() + 400 * HOUR_MS)
    expect(oracleAllows(o, 'retry_charge', FAILED_AT, far)).toBe(false)
  })

  it('is false for an attempt before the failure itself', () => {
    const before = new Date(FAILED_AT.getTime() - HOUR_MS)
    expect(oracleAllows(oracle(), 'retry_charge', FAILED_AT, before)).toBe(false)
  })

  it('treats each intervention independently', () => {
    const o = oracle({ send_nudge: { succeeds: true, afterMs: HOUR_MS } })
    const at = new Date(FAILED_AT.getTime() + 2 * HOUR_MS)
    expect(oracleAllows(o, 'send_nudge', FAILED_AT, at)).toBe(true)
    expect(oracleAllows(o, 'retry_charge', FAILED_AT, at)).toBe(false)
  })
})

describe('recoverabilityOracleSchema', () => {
  it('accepts a well formed oracle from the json column', () => {
    expect(recoverabilityOracleSchema.safeParse(oracle()).success).toBe(true)
  })

  it('rejects a negative or fractional delay', () => {
    expect(
      recoverabilityOracleSchema.safeParse(
        oracle({ retry_charge: { succeeds: true, afterMs: -1 } }),
      ).success,
    ).toBe(false)
    expect(
      recoverabilityOracleSchema.safeParse(
        oracle({ retry_charge: { succeeds: true, afterMs: 1.5 } }),
      ).success,
    ).toBe(false)
  })

  it('rejects a missing intervention', () => {
    const { retry_charge: _omitted, ...partial } = oracle()
    expect(recoverabilityOracleSchema.safeParse(partial).success).toBe(false)
  })
})
