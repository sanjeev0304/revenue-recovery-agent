import { prisma } from '@revenue/db'
import {
  decide,
  oracleAllows,
  recoverabilityOracleSchema,
  type Diagnosis,
  type EvalSplit,
  type Intervention,
  type PaymentFacts,
  type RecoverabilityOracle,
  type RootCause,
} from '@revenue/core'

export interface EvalRecord {
  id: string
  razorpayPaymentId: string
  facts: PaymentFacts
  timezone: string
  optedOut: boolean
  oracle: RecoverabilityOracle | null
  trueCause: RootCause | null
}

export interface EvalOptions {
  split: EvalSplit
  limit?: number
  maxSteps?: number
  diagnose: (record: EvalRecord) => Promise<Diagnosis>
}

export interface EvalReport {
  processed: number
  recovered: number
  recoveredPaise: number
  totalPaise: number
  chargeAttempts: number
  wastedChargeAttempts: number
  contacts: number
  escalated: number
  vetoed: number
  quietHoursViolations: number
  byCause: Record<string, { total: number; recovered: number }>
  correct: number
  llmClassified: number
}

const INTERVENTION_FOR: Record<string, Intervention | null> = {
  retry_charge: 'retry_charge',
  issue_payment_link: 'issue_payment_link',
  send_nudge: 'send_nudge',
  escalate: null,
}

export async function loadEvalRecords(
  split: EvalSplit,
  limit?: number,
): Promise<EvalRecord[]> {
  const rows = await prisma.paymentAttempt.findMany({
    where: { evalSplit: split, isSynthetic: true },
    orderBy: { failedAt: 'asc' },
    ...(limit === undefined ? {} : { take: limit }),
    select: {
      id: true,
      razorpayPaymentId: true,
      customerId: true,
      amountPaise: true,
      method: true,
      errorCode: true,
      errorDescription: true,
      errorSource: true,
      errorStep: true,
      errorReason: true,
      failedAt: true,
      attemptNumber: true,
      recoverableUnder: true,
      syntheticTrueCause: true,
      customer: { select: { timezone: true, optedOut: true } },
    },
  })

  return rows.map((row) => {
    const parsed = recoverabilityOracleSchema.safeParse(row.recoverableUnder)
    return {
      id: row.id,
      razorpayPaymentId: row.razorpayPaymentId,
      timezone: row.customer.timezone,
      optedOut: row.customer.optedOut,
      oracle: parsed.success ? parsed.data : null,
      trueCause: row.syntheticTrueCause,
      facts: {
        paymentId: row.razorpayPaymentId,
        customerId: row.customerId,
        amountPaise: row.amountPaise,
        method: row.method,
        failure: {
          code: row.errorCode,
          description: row.errorDescription,
          source: row.errorSource,
          step: row.errorStep,
          reason: row.errorReason,
        },
        failedAt: row.failedAt,
        attemptNumber: row.attemptNumber,
      },
    }
  })
}

export async function runEval(
  records: readonly EvalRecord[],
  options: EvalOptions,
): Promise<EvalReport> {
  const maxSteps = options.maxSteps ?? 6

  const report: EvalReport = {
    processed: 0,
    recovered: 0,
    recoveredPaise: 0,
    totalPaise: 0,
    chargeAttempts: 0,
    wastedChargeAttempts: 0,
    contacts: 0,
    escalated: 0,
    vetoed: 0,
    quietHoursViolations: 0,
    byCause: {},
    correct: 0,
    llmClassified: 0,
  }

  const contactsByCustomer = new Map<string, number>()

  for (const record of records) {
    const cause = record.trueCause ?? 'UNKNOWN'
    report.byCause[cause] ??= { total: 0, recovered: 0 }
    report.byCause[cause]!.total++
    report.processed++
    report.totalPaise += record.facts.amountPaise

    const diagnosis = await options.diagnose(record)
    if (diagnosis.classifier === 'llm') report.llmClassified++
    if (diagnosis.rootCause === record.trueCause) report.correct++

    let chargeAttempts = 0
    let lastChargeAttemptAt: Date | null = null
    let contactsForPayment = 0
    let completedSteps = 0
    let lastActionAt: Date | null = null
    const usedKeys = new Set<string>()
    let recovered = false
    let simulatedNow = record.facts.failedAt

    for (let step = 0; step < maxSteps; step++) {
      const decision = decide({
        payment: record.facts,
        customer: {
          customerId: record.facts.customerId,
          timezone: record.timezone,
          optedOut: record.optedOut,
        },
        diagnosis,
        history: {
          chargeAttempts,
          lastChargeAttemptAt,
          contactsForPayment,
          contactsForCustomerLast7d: contactsByCustomer.get(record.facts.customerId) ?? 0,
          completedSteps,
          lastActionAt,
          usedIdempotencyKeys: usedKeys,
        },
        now: simulatedNow,
      })

      const action = decision.proposedAction
      if (action === null) break

      if (!decision.guardrailVerdict.allowed) {
        report.vetoed++
        break
      }

      const at = action.scheduledFor ?? simulatedNow
      simulatedNow = at > simulatedNow ? at : simulatedNow
      usedKeys.add(action.idempotencyKey)
      completedSteps++
      lastActionAt = simulatedNow

      if (action.type === 'escalate') {
        report.escalated++
        break
      }

      if (action.type === 'retry_charge') {
        chargeAttempts++
        lastChargeAttemptAt = simulatedNow
        report.chargeAttempts++
        if (record.oracle !== null && !record.oracle.retry_charge.succeeds) {
          report.wastedChargeAttempts++
        }
      }

      if (action.type === 'send_nudge') {
        contactsForPayment++
        report.contacts++
        contactsByCustomer.set(
          record.facts.customerId,
          (contactsByCustomer.get(record.facts.customerId) ?? 0) + 1,
        )
      }

      const intervention = INTERVENTION_FOR[action.type]
      if (intervention !== null && intervention !== undefined && record.oracle !== null) {
        if (oracleAllows(record.oracle, intervention, record.facts.failedAt, simulatedNow)) {
          recovered = true
          break
        }
      }
    }

    if (recovered) {
      report.recovered++
      report.recoveredPaise += record.facts.amountPaise
      report.byCause[cause]!.recovered++
    }
  }

  return report
}

export interface BaselineReport {
  processed: number
  recovered: number
  recoveredPaise: number
  totalPaise: number
  chargeAttempts: number
  wastedChargeAttempts: number
  byCause: Record<string, { total: number; recovered: number }>
}

const BASELINE_SCHEDULE_MS = [1 * 3_600_000, 6 * 3_600_000, 24 * 3_600_000]

export function runBaseline(records: readonly EvalRecord[]): BaselineReport {
  const report: BaselineReport = {
    processed: 0,
    recovered: 0,
    recoveredPaise: 0,
    totalPaise: 0,
    chargeAttempts: 0,
    wastedChargeAttempts: 0,
    byCause: {},
  }

  for (const record of records) {
    const cause = record.trueCause ?? 'UNKNOWN'
    report.byCause[cause] ??= { total: 0, recovered: 0 }
    report.byCause[cause]!.total++
    report.processed++
    report.totalPaise += record.facts.amountPaise

    let recovered = false

    for (const offset of BASELINE_SCHEDULE_MS) {
      report.chargeAttempts++
      if (record.oracle !== null && !record.oracle.retry_charge.succeeds) {
        report.wastedChargeAttempts++
      }
      const at = new Date(record.facts.failedAt.getTime() + offset)
      if (
        record.oracle !== null &&
        oracleAllows(record.oracle, 'retry_charge', record.facts.failedAt, at)
      ) {
        recovered = true
        break
      }
    }

    if (recovered) {
      report.recovered++
      report.recoveredPaise += record.facts.amountPaise
      report.byCause[cause]!.recovered++
    }
  }

  return report
}
