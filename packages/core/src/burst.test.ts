import { describe, expect, it } from 'vitest'
import { BURST_WINDOW_MS, summariseBurst, type BurstCounts } from './burst.js'

function counts(over: Partial<BurstCounts> = {}): BurstCounts {
  return {
    windowMs: BURST_WINDOW_MS,
    failuresInWindow: over.failuresInWindow ?? 34,
    baselineForWindow: over.baselineForWindow ?? 3,
    sameMethodCount: over.sameMethodCount ?? 31,
    sameReasonCount: over.sameReasonCount ?? 30,
  }
}

describe('summariseBurst', () => {
  it('computes a ratio against the baseline', () => {
    const b = summariseBurst(counts())
    expect(b.ratio).toBeCloseTo(34 / 3, 5)
    expect(b.sameMethodShare).toBeCloseTo(31 / 34, 5)
    expect(b.sameReasonShare).toBeCloseTo(30 / 34, 5)
  })

  it('treats a baseline below one as one, so a quiet window cannot divide by zero', () => {
    const b = summariseBurst(
      counts({ baselineForWindow: 0, failuresInWindow: 9, sameMethodCount: 9, sameReasonCount: 8 }),
    )
    expect(b.ratio).toBe(9)
  })

  it('reports zero shares for an empty window rather than NaN', () => {
    const b = summariseBurst(
      counts({ failuresInWindow: 0, sameMethodCount: 0, sameReasonCount: 0 }),
    )
    expect(b.ratio).toBe(0)
    expect(b.sameMethodShare).toBe(0)
    expect(b.sameReasonShare).toBe(0)
  })

  it('keeps shares within 0..1', () => {
    const b = summariseBurst(counts({ failuresInWindow: 5, sameMethodCount: 5, sameReasonCount: 0 }))
    expect(b.sameMethodShare).toBe(1)
    expect(b.sameReasonShare).toBe(0)
  })

  it('rejects a sub-count larger than the window count', () => {
    expect(() =>
      summariseBurst(counts({ failuresInWindow: 3, sameMethodCount: 4, sameReasonCount: 1 })),
    ).toThrow(/sameMethodCount/)
    expect(() =>
      summariseBurst(counts({ failuresInWindow: 3, sameMethodCount: 1, sameReasonCount: 9 })),
    ).toThrow(/sameReasonCount/)
  })

  it('rejects negative and non-finite input', () => {
    expect(() =>
      summariseBurst(counts({ failuresInWindow: -1, sameMethodCount: 0, sameReasonCount: 0 })),
    ).toThrow()
    expect(() => summariseBurst(counts({ baselineForWindow: Number.NaN }))).toThrow()
  })

  it('is pure', () => {
    const c = counts()
    const snapshot = JSON.stringify(c)
    summariseBurst(c)
    expect(JSON.stringify(c)).toBe(snapshot)
    expect(summariseBurst(counts())).toEqual(summariseBurst(counts()))
  })
})
