import { prisma } from '@revenue/db'
import type { ActionType, RootCause } from '@revenue/core'

export type BoardStatus = 'failed' | 'in_progress' | 'recovered' | 'escalated' | 'abandoned'

export interface NextAction {
  type: ActionType
  scheduledFor: string | null
  vetoedBy: string | null
  vetoReason: string | null
}

export interface BoardRow {
  id: string
  razorpayPaymentId: string
  amountPaise: number
  method: string
  reason: string | null
  cause: RootCause | null
  confidence: number | null
  classifier: string | null
  status: BoardStatus
  failedAt: string
  next: NextAction | null
}

export interface BoardCounters {
  total: number
  recovered: number
  inProgress: number
  escalated: number
  failed: number
  abandoned: number
  totalPaise: number
  recoveredPaise: number
}

export interface Board {
  rows: BoardRow[]
  counters: BoardCounters
  causes: RootCause[]
  truncated: boolean
}

export interface BoardQuery {
  status?: BoardStatus
  cause?: RootCause
  limit?: number
}

const ACTION_RANK: Record<string, number> = {
  scheduled: 0,
  executing: 1,
  proposed: 2,
  vetoed: 3,
  succeeded: 4,
  failed: 5,
}

export async function loadBoard(query: BoardQuery = {}): Promise<Board> {
  const limit = query.limit ?? 1200

  const rows = await prisma.paymentAttempt.findMany({
    where: { isSynthetic: true, evalSplit: 'train' },
    orderBy: { failedAt: 'desc' },
    take: limit + 1,
    select: {
      id: true,
      razorpayPaymentId: true,
      amountPaise: true,
      method: true,
      status: true,
      errorReason: true,
      failedAt: true,
      diagnosis: {
        select: { rootCause: true, confidence: true, classifier: true },
      },
      actions: {
        select: {
          type: true,
          status: true,
          scheduledFor: true,
          executedAt: true,
          vetoedBy: true,
          vetoReason: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  const truncated = rows.length > limit
  const page = truncated ? rows.slice(0, limit) : rows

  const mapped: BoardRow[] = page.map((row) => {
    const escalated = row.actions.some(
      (a) => a.type === 'escalate' && a.status === 'succeeded',
    )

    let status: BoardStatus
    if (row.status === 'recovered') status = 'recovered'
    else if (escalated) status = 'escalated'
    else if (row.status === 'abandoned') status = 'abandoned'
    else if (row.actions.length > 0 || row.diagnosis !== null) status = 'in_progress'
    else status = 'failed'

    const pending = [...row.actions].sort((a, b) => {
      const rank = (ACTION_RANK[a.status] ?? 9) - (ACTION_RANK[b.status] ?? 9)
      if (rank !== 0) return rank
      return b.createdAt.getTime() - a.createdAt.getTime()
    })[0]

    const next: NextAction | null =
      pending === undefined
        ? null
        : {
            type: pending.type,
            scheduledFor: (pending.scheduledFor ?? pending.executedAt)?.toISOString() ?? null,
            vetoedBy: pending.vetoedBy,
            vetoReason: pending.vetoReason,
          }

    return {
      id: row.id,
      razorpayPaymentId: row.razorpayPaymentId,
      amountPaise: row.amountPaise,
      method: row.method,
      reason: row.errorReason,
      cause: row.diagnosis?.rootCause ?? null,
      confidence: row.diagnosis?.confidence ?? null,
      classifier: row.diagnosis?.classifier ?? null,
      status,
      failedAt: row.failedAt.toISOString(),
      next,
    }
  })

  const counters = mapped.reduce<BoardCounters>(
    (acc, r) => {
      acc.total++
      acc.totalPaise += r.amountPaise
      if (r.status === 'recovered') {
        acc.recovered++
        acc.recoveredPaise += r.amountPaise
      }
      if (r.status === 'in_progress') acc.inProgress++
      if (r.status === 'escalated') acc.escalated++
      if (r.status === 'failed') acc.failed++
      if (r.status === 'abandoned') acc.abandoned++
      return acc
    },
    {
      total: 0,
      recovered: 0,
      inProgress: 0,
      escalated: 0,
      failed: 0,
      abandoned: 0,
      totalPaise: 0,
      recoveredPaise: 0,
    },
  )

  const causes = [
    ...new Set(mapped.map((r) => r.cause).filter((c): c is RootCause => c !== null)),
  ].sort()

  const filtered = mapped.filter(
    (r) =>
      (query.status === undefined || r.status === query.status) &&
      (query.cause === undefined || r.cause === query.cause),
  )

  return { rows: filtered, counters, causes, truncated }
}
