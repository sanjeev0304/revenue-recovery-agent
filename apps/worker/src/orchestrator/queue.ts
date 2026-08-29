import { Queue, Worker, type ConnectionOptions, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'
import type { Clock } from '../clock.js'
import {
  handleRecoveryJob,
  type HandlerResult,
  type OrchestratorDeps,
  type RecoveryJob,
  type ScheduleRequest,
} from './handler.js'

export const RECOVERY_QUEUE = 'recovery'

export function createConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}

export function createRecoveryQueue(connection: ConnectionOptions): Queue<RecoveryJob> {
  return new Queue<RecoveryJob>(RECOVERY_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 5000 },
      removeOnFail: { count: 5000 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    },
  })
}

export function jobOptionsFor(request: ScheduleRequest): JobsOptions {
  return {
    delay: request.delayMs,
    jobId: request.idempotencyKey,
  }
}

export function queueScheduler(queue: Queue<RecoveryJob>): OrchestratorDeps['schedule'] {
  return async (request) => {
    await queue.add(
      'recovery',
      { paymentAttemptId: request.paymentAttemptId },
      jobOptionsFor(request),
    )
  }
}

export interface RecoveryWorkerOptions {
  connection: ConnectionOptions
  deps: OrchestratorDeps
  concurrency?: number
  onResult?: (job: RecoveryJob, result: HandlerResult) => void
}

export function createRecoveryWorker(options: RecoveryWorkerOptions): Worker<RecoveryJob> {
  return new Worker<RecoveryJob>(
    RECOVERY_QUEUE,
    async (job) => {
      const result = await handleRecoveryJob(options.deps, job.data)
      options.onResult?.(job.data, result)
      return result
    },
    { connection: options.connection, concurrency: options.concurrency ?? 5 },
  )
}

export function describeSchedule(request: ScheduleRequest, clock: Clock): string {
  return `${request.idempotencyKey} runs at ${request.runAt.toISOString()} in ${request.delayMs}ms (${clock.describe()})`
}
