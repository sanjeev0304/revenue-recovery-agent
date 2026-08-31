import { prisma } from '@revenue/db'
import type { ChargeOutcome, ExecutorRegistry } from '@revenue/core'
import { decide } from '@revenue/core'
import { WarpedClock } from '../clock.js'
import { PrismaIngestRepo } from '../ingest/prismaRepo.js'
import { recordChargeOutcome } from '../ingest/recordChargeOutcome.js'
import { MockChannel } from '../executors/mockChannel.js'
import {
  EscalateExecutor,
  IssuePaymentLinkExecutor,
  RetryChargeExecutor,
  SendNudgeExecutor,
} from '../executors/simulated.js'
import { SimulatedAdapter } from '../adapters/simulated.js'
import { createDiagnoser } from '../llm/diagnose.js'
import { GeminiProvider } from '../llm/gemini.js'
import { executeDecision } from './execute.js'
import { retryTransient } from './retry.js'
import {
  loadContext,
  loadOracle,
  persistDecision,
  PrismaExecutionStore,
  resetBatchState,
} from './prismaContext.js'

export interface BatchOptions {
  split: 'train'
  limit: number
  concurrency: number
  maxSteps: number
  warpFactor: number
  reset: boolean
  llm: boolean
}

export interface BatchReport {
  processed: number
  recovered: number
  recoveredPaise: number
  totalPaise: number
  escalated: number
  vetoed: number
  chargeAttempts: number
  contacts: number
  byCause: Record<string, { total: number; recovered: number }>
  failed: Array<{ paymentId: string; error: string }>
  llmModel: string | null
  llmCalls: number
  llmCacheHits: number
  llmParseFailures: number
}

export async function runBatch(options: BatchOptions): Promise<BatchReport> {
  if (options.split !== 'train') {
    throw new Error('runBatch may only touch the train split; the holdout is frozen')
  }

  const rows = await prisma.paymentAttempt.findMany({
    where: { evalSplit: 'train', isSynthetic: true },
    orderBy: { failedAt: 'asc' },
    take: options.limit,
    select: { id: true, razorpayPaymentId: true, amountPaise: true, syntheticTrueCause: true },
  })

  if (options.reset) {
    for (let i = 0; i < rows.length; i += 200) {
      await resetBatchState(rows.slice(i, i + 200).map((r) => r.id))
    }
  }

  const apiKey = process.env['GEMINI_API_KEY'] ?? ''
  const modelName = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash'

  if (options.llm && apiKey === '') {
    throw new Error('GEMINI_API_KEY is not set; re-run with --no-llm to use the stub')
  }

  const provider = options.llm
    ? new GeminiProvider({ apiKey, model: modelName })
    : null
  const { diagnose, stats } = createDiagnoser({ provider })
  const diagnoser = options.llm ? diagnose : undefined

  const repo = new PrismaIngestRepo()
  const store = new PrismaExecutionStore()
  const channel = new MockChannel()

  const onOutcome = async (outcome: ChargeOutcome): Promise<void> => {
    await recordChargeOutcome(repo, outcome)
  }

  const oracles = { load: loadOracle }
  const executors: ExecutorRegistry = {
    retry_charge: new RetryChargeExecutor(
      new SimulatedAdapter({ loadOracle, onOutcome }),
    ),
    issue_payment_link: new IssuePaymentLinkExecutor({ oracles, onOutcome, channel }),
    send_nudge: new SendNudgeExecutor({ oracles, onOutcome, channel }),
    escalate: new EscalateExecutor(),
  }

  const report: BatchReport = {
    processed: 0,
    recovered: 0,
    recoveredPaise: 0,
    totalPaise: 0,
    escalated: 0,
    vetoed: 0,
    chargeAttempts: 0,
    contacts: 0,
    byCause: {},
    failed: [],
    llmModel: options.llm ? modelName : null,
    llmCalls: 0,
    llmCacheHits: 0,
    llmParseFailures: 0,
  }

  async function processOne(row: (typeof rows)[number]): Promise<void> {
    const cause = row.syntheticTrueCause ?? 'UNKNOWN'
    report.byCause[cause] ??= { total: 0, recovered: 0 }
    report.byCause[cause]!.total++
    report.processed++
    report.totalPaise += row.amountPaise

    let cursor = 0
    const loaded0 = await retryTransient('loadContext', () => loadContext(row.id, diagnoser))
    if (loaded0 === null) return

    const clock = new WarpedClock(loaded0.failedAt, 1, () => cursor)
    let recovered = false

    for (let step = 0; step < options.maxSteps; step++) {
      const loaded = await retryTransient('loadContext', () => loadContext(row.id, diagnoser))
      if (loaded === null) break

      const now = clock.now()
      const decision = decide({ ...loaded.context, now })

      await retryTransient('persistDecision', () =>
        persistDecision({
          decision,
          occurredAt: now,
          paymentAttemptId: row.id,
          ...(options.llm ? { llmModel: modelName } : {}),
        }),
      )

      const action = decision.proposedAction
      if (action === null) break

      if (!decision.guardrailVerdict.allowed) {
        report.vetoed++
        await executeDecision(
          { store, executors },
          {
            paymentAttemptId: row.id,
            decision,
            amountPaise: loaded.amountPaise,
            method: loaded.method,
            failedAt: loaded.failedAt,
            occurredAt: now,
          },
        )
        break
      }

      if (action.scheduledFor !== null) {
        const target = action.scheduledFor.getTime() - loaded0.failedAt.getTime()
        cursor = Math.max(cursor, target)
      }

      const at = clock.now()
      if (action.type === 'retry_charge') report.chargeAttempts++
      if (action.type === 'send_nudge') report.contacts++
      if (action.type === 'escalate') report.escalated++

      await executeDecision(
        { store, executors },
        {
          paymentAttemptId: row.id,
          decision,
          amountPaise: loaded.amountPaise,
          method: loaded.method,
          failedAt: loaded.failedAt,
          occurredAt: at,
        },
      )

      const after = await retryTransient('statusCheck', () =>
        prisma.paymentAttempt.findUnique({
          where: { id: row.id },
          select: { status: true },
        }),
      )

      if (after?.status === 'recovered') {
        recovered = true
        break
      }
      if (action.type === 'escalate') break
    }

    if (recovered) {
      report.recovered++
      report.recoveredPaise += row.amountPaise
      report.byCause[cause]!.recovered++
    }
  }

  const queue = [...rows]
  const workers = Array.from({ length: options.concurrency }, async () => {
    for (;;) {
      const next = queue.shift()
      if (next === undefined) return
      try {
        await processOne(next)
      } catch (err) {
        report.failed.push({
          paymentId: next.razorpayPaymentId,
          error: (err as Error).message.slice(0, 200),
        })
      }
    }
  })
  await Promise.all(workers)

  report.llmCalls = stats.apiCalls
  report.llmCacheHits = stats.cacheHits
  report.llmParseFailures = stats.parseFailures

  return report
}
