import { rootCauseSchema, type EvalArm, type RootCause } from '@revenue/core'
import { operationalCostPaise } from './cost.js'
import type { ArmResult, RecordResult } from './arms.js'
import type { EvalRecord } from './simulate.js'

export const ALL_CAUSES: readonly RootCause[] = rootCauseSchema.options

export interface CauseBucket {
  total: number
  recovered: number
  totalPaise: number
  recoveredPaise: number
}

export interface ArmMetrics {
  key: string
  label: string
  arm: EvalArm
  llmEnabled: boolean
  processed: number
  recovered: number
  recoveredPaise: number
  totalPaise: number
  chargeAttempts: number
  wastedChargeAttempts: number
  contacts: number
  linksIssued: number
  escalated: number
  vetoed: number
  vetoedBy: Record<string, number>
  quietHoursViolations: number
  operationalCostPaise: number
  byCause: Record<string, CauseBucket>
}

export function aggregate(arm: ArmResult): ArmMetrics {
  const m: ArmMetrics = {
    key: arm.key,
    label: arm.label,
    arm: arm.arm,
    llmEnabled: arm.llmEnabled,
    processed: 0,
    recovered: 0,
    recoveredPaise: 0,
    totalPaise: 0,
    chargeAttempts: 0,
    wastedChargeAttempts: 0,
    contacts: 0,
    linksIssued: 0,
    escalated: 0,
    vetoed: 0,
    vetoedBy: {},
    quietHoursViolations: 0,
    operationalCostPaise: 0,
    byCause: {},
  }

  for (const { record, outcome } of arm.results) {
    const cause = record.trueCause
    m.byCause[cause] ??= { total: 0, recovered: 0, totalPaise: 0, recoveredPaise: 0 }
    const bucket = m.byCause[cause]!

    m.processed++
    m.totalPaise += record.facts.amountPaise
    bucket.total++
    bucket.totalPaise += record.facts.amountPaise

    if (outcome.recovered) {
      m.recovered++
      m.recoveredPaise += outcome.recoveredPaise
      bucket.recovered++
      bucket.recoveredPaise += outcome.recoveredPaise
    }

    m.chargeAttempts += outcome.chargeAttempts
    m.wastedChargeAttempts += outcome.wastedChargeAttempts
    m.contacts += outcome.contacts
    m.linksIssued += outcome.linksIssued
    m.quietHoursViolations += outcome.quietHoursViolations
    if (outcome.escalated) m.escalated++
    if (outcome.vetoed) {
      m.vetoed++
      const by = outcome.vetoedBy ?? 'unknown'
      m.vetoedBy[by] = (m.vetoedBy[by] ?? 0) + 1
    }
  }

  m.operationalCostPaise = operationalCostPaise(m.chargeAttempts, m.contacts)
  return m
}

export interface PerClass {
  cause: RootCause
  support: number
  predicted: number
  tp: number
  fp: number
  fn: number
}

export interface ClassificationMetrics {
  total: number
  correct: number
  llmClassified: number
  perClass: PerClass[]
  confusion: Record<string, Record<string, number>>
}

export function classification(arm: ArmResult): ClassificationMetrics | null {
  const withPrediction = arm.results.filter(
    (r): r is RecordResult & { predicted: RootCause } => r.predicted !== null,
  )
  if (withPrediction.length === 0) return null

  const confusion: Record<string, Record<string, number>> = {}
  let correct = 0
  let llmClassified = 0

  const counts = new Map<RootCause, { support: number; predicted: number; tp: number }>()
  for (const cause of ALL_CAUSES) counts.set(cause, { support: 0, predicted: 0, tp: 0 })

  for (const r of withPrediction) {
    const t = r.record.trueCause
    const p = r.predicted

    confusion[p] ??= {}
    confusion[p]![t] = (confusion[p]![t] ?? 0) + 1

    counts.get(t)!.support++
    counts.get(p)!.predicted++
    if (p === t) {
      correct++
      counts.get(t)!.tp++
    }
    if (r.classifier === 'llm') llmClassified++
  }

  const perClass: PerClass[] = ALL_CAUSES.map((cause) => {
    const c = counts.get(cause)!
    return {
      cause,
      support: c.support,
      predicted: c.predicted,
      tp: c.tp,
      fp: c.predicted - c.tp,
      fn: c.support - c.tp,
    }
  })

  return { total: withPrediction.length, correct, llmClassified, perClass, confusion }
}

export interface MatrixCell {
  predicted: RootCause
  trueCause: RootCause
  n: number
  recoveredPaise: number
  oracleRecoveredPaise: number
  shortfallPaise: number
  chargeAttempts: number
  wastedChargeAttempts: number
  contacts: number
  costPaise: number
}

export function costWeightedConfusion(agent: ArmResult, oracle: ArmResult): MatrixCell[] {
  const oracleByRecord = new Map(oracle.results.map((r) => [r.record.id, r]))
  const cells = new Map<string, MatrixCell>()

  for (const r of agent.results) {
    if (r.predicted === null) continue
    const key = `${r.predicted}|${r.record.trueCause}`

    let cell = cells.get(key)
    if (cell === undefined) {
      cell = {
        predicted: r.predicted,
        trueCause: r.record.trueCause,
        n: 0,
        recoveredPaise: 0,
        oracleRecoveredPaise: 0,
        shortfallPaise: 0,
        chargeAttempts: 0,
        wastedChargeAttempts: 0,
        contacts: 0,
        costPaise: 0,
      }
      cells.set(key, cell)
    }

    cell.n++
    cell.recoveredPaise += r.outcome.recoveredPaise
    cell.chargeAttempts += r.outcome.chargeAttempts
    cell.wastedChargeAttempts += r.outcome.wastedChargeAttempts
    cell.contacts += r.outcome.contacts
    cell.oracleRecoveredPaise += oracleByRecord.get(r.record.id)?.outcome.recoveredPaise ?? 0
  }

  for (const cell of cells.values()) {
    cell.shortfallPaise = cell.oracleRecoveredPaise - cell.recoveredPaise
    cell.costPaise = operationalCostPaise(cell.chargeAttempts, cell.contacts)
  }

  return [...cells.values()].sort((a, b) => {
    if (a.predicted !== b.predicted) return a.predicted.localeCompare(b.predicted)
    return b.n - a.n
  })
}

export interface SubsetAccuracy {
  total: number
  correct: number
}

export interface OpaqueSubset {
  majorityCause: RootCause
  majorityCount: number
  all: SubsetAccuracy
  genuine: SubsetAccuracy
  masked: SubsetAccuracy
  maskedInBurst: SubsetAccuracy
  maskedScattered: SubsetAccuracy
}

function tally(results: readonly RecordResult[]): SubsetAccuracy {
  return {
    total: results.length,
    correct: results.filter((r) => r.predicted === r.record.trueCause).length,
  }
}

export function majorityCauseOfOpaqueSubset(records: readonly EvalRecord[]): {
  cause: RootCause
  count: number
  total: number
} {
  const opaque = records.filter((r) => r.opaqueReason)
  const counts = new Map<RootCause, number>()
  for (const r of opaque) counts.set(r.trueCause, (counts.get(r.trueCause) ?? 0) + 1)

  let cause: RootCause = 'OPAQUE_BANK_DECLINE'
  let count = 0
  for (const [c, n] of counts) {
    if (n > count) {
      cause = c
      count = n
    }
  }
  return { cause, count, total: opaque.length }
}

export function opaqueSubset(arm: ArmResult, majorityCause: RootCause): OpaqueSubset {
  const opaque = arm.results.filter((r) => r.record.opaqueReason)
  const masked = opaque.filter((r) => r.record.masked)

  return {
    majorityCause,
    majorityCount: opaque.filter((r) => r.record.trueCause === majorityCause).length,
    all: tally(opaque),
    genuine: tally(opaque.filter((r) => !r.record.masked)),
    masked: tally(masked),
    maskedInBurst: tally(masked.filter((r) => r.record.incidentId !== null)),
    maskedScattered: tally(masked.filter((r) => r.record.incidentId === null)),
  }
}
