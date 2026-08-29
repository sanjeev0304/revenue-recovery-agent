import { describe, expect, it } from 'vitest'
import { WarpedClock, RealClock } from '../clock.js'
import { describeSchedule, jobOptionsFor } from './queue.js'
import type { ScheduleRequest } from './handler.js'

const request: ScheduleRequest = {
  paymentAttemptId: 'pay_1',
  delayMs: 24_000,
  runAt: new Date('2026-07-15T06:30:00Z'),
  idempotencyKey: 'pay_1:0:retry_charge',
}

describe('jobOptionsFor', () => {
  it('uses the idempotency key as the BullMQ job id, so a duplicate is dropped by Redis', () => {
    expect(jobOptionsFor(request)).toEqual({
      delay: 24_000,
      jobId: 'pay_1:0:retry_charge',
    })
  })

  it('passes the already-compressed delay straight through', () => {
    expect(jobOptionsFor({ ...request, delayMs: 0 }).delay).toBe(0)
    expect(jobOptionsFor({ ...request, delayMs: 86_400_000 }).delay).toBe(86_400_000)
  })

  it('gives two steps of one payment different job ids', () => {
    const a = jobOptionsFor(request).jobId
    const b = jobOptionsFor({ ...request, idempotencyKey: 'pay_1:1:send_nudge' }).jobId
    expect(a).not.toBe(b)
  })
})

describe('describeSchedule', () => {
  it('names the clock so a warped run is visible in the logs', () => {
    const warped = describeSchedule(request, new WarpedClock(new Date('2026-07-14T00:00:00Z'), 3600, () => 0))
    expect(warped).toContain('warped x3600')
    expect(warped).toContain('2026-07-15T06:30:00.000Z')

    expect(describeSchedule(request, new RealClock())).toContain('real time')
  })
})
