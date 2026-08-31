import { describe, expect, it } from 'vitest'
import { retryTransient } from './retry.js'

const transient = (code: string): Error => Object.assign(new Error(code), { code })

describe('retryTransient', () => {
  it('returns immediately on success', async () => {
    let calls = 0
    const out = await retryTransient('t', async () => {
      calls++
      return 'ok'
    })
    expect(out).toBe('ok')
    expect(calls).toBe(1)
  })

  it('retries a dropped connection and succeeds', async () => {
    let calls = 0
    const out = await retryTransient('t', async () => {
      calls++
      if (calls < 3) throw transient('P1017')
      return 'ok'
    })
    expect(out).toBe('ok')
    expect(calls).toBe(3)
  })

  it('does not retry a unique constraint violation, which is not transient', async () => {
    let calls = 0
    await expect(
      retryTransient('t', async () => {
        calls++
        throw transient('P2002')
      }),
    ).rejects.toThrow()
    expect(calls).toBe(1)
  })

  it('gives up after the attempt budget and names the operation', async () => {
    let calls = 0
    await expect(
      retryTransient(
        'closeAction',
        async () => {
          calls++
          throw transient('P1017')
        },
        3,
      ),
    ).rejects.toThrow(/closeAction failed after 3 attempts/)
    expect(calls).toBe(3)
  })
})
