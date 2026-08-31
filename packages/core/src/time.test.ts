import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  HOUR_MS,
  addMs,
  deferPastQuietHours,
  isLastWorkingDayOfMonth,
  localHour,
  nextLocalMidnight,
  nextSalaryWindow,
} from './time.js'

const IST = 'Asia/Kolkata'

describe('localHour', () => {
  it('shifts UTC into IST (+5:30)', () => {
    expect(localHour(new Date('2026-01-01T00:00:00Z'), IST)).toBe(5)
    expect(localHour(new Date('2026-01-01T18:30:00Z'), IST)).toBe(0)
    expect(localHour(new Date('2026-01-01T15:30:00Z'), IST)).toBe(21)
  })

  it('handles a half-hour zone crossing midnight', () => {
    expect(localHour(new Date('2026-01-01T18:29:00Z'), IST)).toBe(23)
  })
})

describe('nextLocalMidnight', () => {
  it('returns the next local midnight as a UTC instant', () => {
    const at = new Date('2026-01-01T00:00:00Z')
    expect(nextLocalMidnight(at, IST).toISOString()).toBe('2026-01-01T18:30:00.000Z')
  })

  it('is strictly in the future when called exactly at local midnight', () => {
    const localMidnight = new Date('2026-01-01T18:30:00Z')
    const next = nextLocalMidnight(localMidnight, IST)
    expect(next.getTime()).toBeGreaterThan(localMidnight.getTime())
    expect(next.toISOString()).toBe('2026-01-02T18:30:00.000Z')
  })

  it('lands within 24h always', () => {
    for (let h = 0; h < 24; h++) {
      const at = new Date(Date.UTC(2026, 5, 10, h, 17))
      const delta = nextLocalMidnight(at, IST).getTime() - at.getTime()
      expect(delta).toBeGreaterThan(0)
      expect(delta).toBeLessThanOrEqual(DAY_MS)
    }
  })

  it('works for a whole-hour zone too', () => {
    const at = new Date('2026-03-10T12:00:00Z')
    expect(nextLocalMidnight(at, 'UTC').toISOString()).toBe('2026-03-11T00:00:00.000Z')
  })
})

describe('isLastWorkingDayOfMonth', () => {
  it('31 Aug 2026 is a Monday, so it is the last working day', () => {
    expect(new Date(Date.UTC(2026, 7, 31)).getUTCDay()).toBe(1)
    expect(isLastWorkingDayOfMonth(2026, 8, 31)).toBe(true)
  })

  it('skips back over a weekend', () => {
    expect(new Date(Date.UTC(2026, 9, 31)).getUTCDay()).toBe(6)
    expect(isLastWorkingDayOfMonth(2026, 10, 31)).toBe(false)
    expect(isLastWorkingDayOfMonth(2026, 10, 30)).toBe(true)
  })

  it('February in a non-leap year', () => {
    expect(isLastWorkingDayOfMonth(2026, 2, 27)).toBe(true)
    expect(isLastWorkingDayOfMonth(2026, 2, 28)).toBe(false)
  })
})

describe('nextSalaryWindow', () => {
  it('finds the 1st of next month from mid-month', () => {
    const at = new Date('2026-09-10T06:00:00Z')
    const w = nextSalaryWindow(at, IST)
    expect(w.getTime()).toBeGreaterThan(at.getTime())
    expect(localHour(w, IST)).toBe(10)
  })

  it('from 28 Aug 2026 the next window is the 31st, not the 1st', () => {
    const at = new Date('2026-08-28T06:00:00Z')
    const w = nextSalaryWindow(at, IST)
    const daysAhead = (w.getTime() - at.getTime()) / DAY_MS
    expect(daysAhead).toBeLessThan(5)
  })

  it('is always strictly in the future', () => {
    for (let d = 1; d <= 28; d++) {
      const at = new Date(Date.UTC(2026, 8, d, 12))
      expect(nextSalaryWindow(at, IST).getTime()).toBeGreaterThan(at.getTime())
    }
  })
})

describe('addMs', () => {
  it('does not mutate its input', () => {
    const at = new Date('2026-01-01T00:00:00Z')
    const out = addMs(at, HOUR_MS)
    expect(at.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(out.toISOString()).toBe('2026-01-01T01:00:00.000Z')
  })
})

describe('deferPastQuietHours', () => {
  const defer = (utc: string) =>
    deferPastQuietHours(new Date(utc), IST, 21, 9)

  it('leaves a daytime contact untouched', () => {
    const noon = new Date('2026-09-01T06:30:00Z')
    expect(defer('2026-09-01T06:30:00Z')).toEqual(noon)
  })

  it('leaves 09:00 and 20:59 local untouched at the boundaries', () => {
    expect(localHour(defer('2026-09-01T03:30:00Z'), IST)).toBe(9)
    expect(defer('2026-09-01T03:30:00Z').toISOString()).toBe('2026-09-01T03:30:00.000Z')
    expect(defer('2026-09-01T15:29:00Z').toISOString()).toBe('2026-09-01T15:29:00.000Z')
  })

  it('defers 21:00 local to 09:00 the next morning', () => {
    const out = defer('2026-09-01T15:30:00Z')
    expect(localHour(out, IST)).toBe(9)
    expect(out.getTime()).toBeGreaterThan(new Date('2026-09-01T15:30:00Z').getTime())
    expect(out.toISOString()).toBe('2026-09-02T03:30:00.000Z')
  })

  it('defers 02:00 local to 09:00 the same morning', () => {
    const out = defer('2026-09-01T20:30:00Z')
    expect(localHour(out, IST)).toBe(9)
    expect(out.toISOString()).toBe('2026-09-02T03:30:00.000Z')
  })

  it('defers 08:59 local by one minute, not by a day', () => {
    const out = defer('2026-09-01T03:29:00Z')
    expect(out.toISOString()).toBe('2026-09-01T03:30:00.000Z')
  })

  it('always lands outside quiet hours, for every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      const at = new Date(Date.UTC(2026, 8, 10, h, 17))
      const out = defer(at.toISOString())
      const hour = localHour(out, IST)
      expect(hour).toBeGreaterThanOrEqual(9)
      expect(hour).toBeLessThan(21)
      expect(out.getTime()).toBeGreaterThanOrEqual(at.getTime())
    }
  })

  it('never moves a contact backwards in time', () => {
    for (let h = 0; h < 24; h++) {
      const at = new Date(Date.UTC(2026, 8, 10, h, 45))
      expect(defer(at.toISOString()).getTime()).toBeGreaterThanOrEqual(at.getTime())
    }
  })
})
