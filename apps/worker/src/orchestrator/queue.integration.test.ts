import { afterAll, describe, expect, it } from 'vitest'
import { Queue, Worker } from 'bullmq'
import { createConnection, RECOVERY_QUEUE } from './queue.js'
import type { RecoveryJob } from './handler.js'

const url = process.env['REDIS_URL'] ?? ''

async function redisReachable(): Promise<string | null> {
  if (url === '') return 'REDIS_URL is not set'
  if (url.includes('host.upstash.io')) return 'REDIS_URL is still the .env.example placeholder'

  const probe = createConnection(url)
  try {
    await Promise.race([
      probe.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000)),
    ])
    return null
  } catch (err) {
    return `REDIS_URL is unreachable: ${(err as Error).message}`
  } finally {
    probe.disconnect()
  }
}

const skipReason = await redisReachable()
if (skipReason !== null) {
  console.warn(`[skip] BullMQ integration tests: ${skipReason}`)
}

const TEST_QUEUE = `${RECOVERY_QUEUE}_itest`
const connection = skipReason === null ? createConnection(url) : null
const queue =
  connection === null ? null : new Queue<RecoveryJob>(TEST_QUEUE, { connection })

afterAll(async () => {
  if (queue === null || connection === null) return
  await queue.obliterate({ force: true }).catch(() => {})
  await queue.close()
  connection.disconnect()
})

describe.skipIf(skipReason !== null)('BullMQ against the real Redis', () => {
  it('connects and reports queue counts', async () => {
    const counts = await queue!.getJobCounts()
    expect(counts).toHaveProperty('waiting')
  })

  it('drops a duplicate jobId, which is what backs idempotent scheduling', async () => {
    const jobId = `itest_dupe_${Date.now()}`
    const a = await queue!.add('recovery', { paymentAttemptId: 'pay_1' }, { jobId, delay: 60_000 })
    const b = await queue!.add('recovery', { paymentAttemptId: 'pay_1' }, { jobId, delay: 60_000 })

    expect(a.id).toBe(jobId)
    expect(b.id).toBe(jobId)

    const delayed = await queue!.getDelayed()
    expect(delayed.filter((j) => j.id === jobId)).toHaveLength(1)
  })

  it('honours a delay and then runs the job', async () => {
    const jobId = `itest_delay_${Date.now()}`
    await queue!.add('recovery', { paymentAttemptId: 'pay_delay' }, { jobId, delay: 1_200 })

    const processed: string[] = []
    const worker = new Worker<RecoveryJob>(
      TEST_QUEUE,
      async (job) => {
        processed.push(job.data.paymentAttemptId)
      },
      { connection: createConnection(url) },
    )

    const started = Date.now()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('job did not run within 15s')), 15_000)
      worker.on('completed', () => {
        clearTimeout(timer)
        resolve()
      })
      worker.on('failed', (_j, err) => {
        clearTimeout(timer)
        reject(err)
      })
    })

    expect(processed).toContain('pay_delay')
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_000)
    await worker.close()
  }, 25_000)
})
