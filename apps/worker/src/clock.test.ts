import { describe, expect, it } from 'vitest'
import { RealClock, WarpedClock, createClock } from './clock.js'

const HOUR = 3_600_000
const T0 = new Date('2026-07-14T00:00:00Z')

function controllable(start: number) {
  let value = start
  return { source: () => value, advance: (ms: number) => (value += ms) }
}

describe('RealClock', () => {
  it('reports its injected source', () => {
    const c = controllable(1000)
    const clock = new RealClock(c.source)
    expect(clock.now().getTime()).toBe(1000)
    c.advance(500)
    expect(clock.now().getTime()).toBe(1500)
  })

  it('delays by the literal gap', () => {
    const c = controllable(T0.getTime())
    const clock = new RealClock(c.source)
    expect(clock.delayUntil(new Date(T0.getTime() + 24 * HOUR))).toBe(24 * HOUR)
  })

  it('never returns a negative delay for a past instant', () => {
    const c = controllable(T0.getTime())
    const clock = new RealClock(c.source)
    expect(clock.delayUntil(new Date(T0.getTime() - HOUR))).toBe(0)
  })
})

describe('WarpedClock', () => {
  it('advances simulated time by the factor', () => {
    const c = controllable(0)
    const clock = new WarpedClock(T0, 3600, c.source)

    expect(clock.now()).toEqual(T0)
    c.advance(1000)
    expect(clock.now().getTime()).toBe(T0.getTime() + 3600 * 1000)
    c.advance(1000)
    expect(clock.now().getTime()).toBe(T0.getTime() + 7_200_000)
  })

  it('compresses a 24h delay into 24 real seconds at x3600', () => {
    const c = controllable(0)
    const clock = new WarpedClock(T0, 3600, c.source)
    expect(clock.delayUntil(new Date(T0.getTime() + 24 * HOUR))).toBe(24_000)
  })

  it('starts at the declared origin regardless of real start time', () => {
    const a = new WarpedClock(T0, 60, controllable(0).source)
    const b = new WarpedClock(T0, 60, controllable(999_999_999).source)
    expect(a.now()).toEqual(b.now())
  })

  it('never returns a negative delay', () => {
    const c = controllable(0)
    const clock = new WarpedClock(T0, 3600, c.source)
    expect(clock.delayUntil(new Date(T0.getTime() - 10 * HOUR))).toBe(0)
  })

  it('rejects a non-positive or non-finite factor', () => {
    expect(() => new WarpedClock(T0, 0)).toThrow(/positive/)
    expect(() => new WarpedClock(T0, -5)).toThrow(/positive/)
    expect(() => new WarpedClock(T0, Number.POSITIVE_INFINITY)).toThrow(/positive/)
  })

  it('rejects an invalid origin', () => {
    expect(() => new WarpedClock(new Date('nonsense'), 60)).toThrow(/origin/)
  })

  it('describes itself for the startup banner', () => {
    expect(new WarpedClock(T0, 3600, controllable(0).source).describe()).toBe(
      'warped x3600 from 2026-07-14T00:00:00.000Z',
    )
    expect(new RealClock().describe()).toBe('real time')
  })

  it('is equivalent to real time at factor 1', () => {
    const c = controllable(T0.getTime())
    const warped = new WarpedClock(T0, 1, c.source)
    const real = new RealClock(c.source)
    c.advance(12345)
    expect(warped.now()).toEqual(real.now())
    const target = new Date(T0.getTime() + 5 * HOUR)
    expect(warped.delayUntil(target)).toBe(real.delayUntil(target))
  })
})

describe('createClock', () => {
  it('returns a real clock when neither warp setting is present', () => {
    expect(createClock({ warpOrigin: null, warpFactor: null }).kind).toBe('real')
  })

  it('returns a warped clock when both are present', () => {
    expect(createClock({ warpOrigin: T0, warpFactor: 60 }).kind).toBe('warped')
  })

  it('refuses one without the other', () => {
    expect(() => createClock({ warpOrigin: T0, warpFactor: null })).toThrow(/together/)
    expect(() => createClock({ warpOrigin: null, warpFactor: 60 })).toThrow(/together/)
  })
})
