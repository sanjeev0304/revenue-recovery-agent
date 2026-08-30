import { randomUUID } from 'node:crypto'
import { Prisma, prisma } from '@revenue/db'
import {
  applyLlmDiagnosis,
  classify,
  recoverabilityOracleSchema,
  type Decision,
  type Diagnosis,
  type ExecutionResult,
  type PaymentFacts,
  type PaymentMethod,
  type RecoverabilityOracle,
} from '@revenue/core'
import type { DecisionContext } from './handler.js'
import type { ExecutionStore } from './execute.js'

const asJson = (v: unknown): Prisma.InputJsonValue => (v ?? Prisma.JsonNull) as Prisma.InputJsonValue

const CONTACT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface LoadedPayment {
  context: DecisionContext
  amountPaise: number
  method: PaymentMethod
  failedAt: Date
}

export function stubDiagnosis(facts: PaymentFacts): Diagnosis {
  const outcome = classify(facts)
  if (outcome.kind === 'resolved') return outcome.diagnosis

  return applyLlmDiagnosis(outcome, {
    rootCause: outcome.provisional,
    confidence: 0.75,
    reasoning:
      'STUB: no LLM provider wired yet, holding the deterministic provisional cause',
  })
}

export async function loadContext(paymentAttemptId: string): Promise<LoadedPayment | null> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { id: paymentAttemptId },
    include: { customer: true, diagnosis: true },
  })
  if (row === null) return null

  const facts: PaymentFacts = {
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
  }

  const diagnosis: Diagnosis =
    row.diagnosis === null
      ? stubDiagnosis(facts)
      : {
          rootCause: row.diagnosis.rootCause,
          confidence: row.diagnosis.confidence,
          classifier: row.diagnosis.classifier,
          evidence: row.diagnosis.evidence,
        }

  const actions = await prisma.action.findMany({
    where: { paymentAttemptId, status: { in: ['succeeded', 'failed', 'executing'] } },
    orderBy: { createdAt: 'asc' },
    select: { type: true, idempotencyKey: true, executedAt: true, createdAt: true },
  })

  const charges = actions.filter((a) => a.type === 'retry_charge')
  const contacts = actions.filter((a) => a.type === 'send_nudge')
  const last = actions.at(-1)

  const customerContacts = await prisma.action.count({
    where: {
      type: 'send_nudge',
      status: { in: ['succeeded', 'failed', 'executing'] },
      paymentAttempt: { customerId: row.customerId },
      createdAt: { gte: new Date(row.failedAt.getTime() - CONTACT_WINDOW_MS) },
    },
  })

  return {
    amountPaise: row.amountPaise,
    method: row.method,
    failedAt: row.failedAt,
    context: {
      payment: facts,
      customer: {
        customerId: row.customerId,
        timezone: row.customer.timezone,
        optedOut: row.customer.optedOut,
      },
      diagnosis,
      history: {
        chargeAttempts: charges.length,
        lastChargeAttemptAt: charges.at(-1)?.executedAt ?? charges.at(-1)?.createdAt ?? null,
        contactsForPayment: contacts.length,
        contactsForCustomerLast7d: customerContacts,
        completedSteps: actions.length,
        lastActionAt: last?.executedAt ?? last?.createdAt ?? null,
        usedIdempotencyKeys: new Set(actions.map((a) => a.idempotencyKey)),
      },
    },
  }
}

export async function persistDecision(input: {
  decision: Decision
  occurredAt: Date
  paymentAttemptId: string
}): Promise<void> {
  const { decision } = input

  await prisma.diagnosis.upsert({
    where: { paymentAttemptId: input.paymentAttemptId },
    create: {
      paymentAttemptId: input.paymentAttemptId,
      rootCause: decision.rootCause,
      confidence: decision.confidence,
      classifier: decision.classifier,
      evidence: decision.evidence,
    },
    update: {},
  })

  await prisma.auditLog.create({
    data: {
      paymentAttemptId: input.paymentAttemptId,
      event: 'diagnosed',
      inputSnapshot: asJson({
        rootCause: decision.rootCause,
        confidence: decision.confidence,
        classifier: decision.classifier,
        razorpayReason: decision.razorpayReason,
      }),
      reasoning: decision.evidence.join(' | ').slice(0, 2000),
      occurredAt: input.occurredAt,
    },
  })
}

export class PrismaExecutionStore implements ExecutionStore {
  async openAction(input: {
    paymentAttemptId: string
    type: string
    idempotencyKey: string
    scheduledFor: Date | null
    payload: Record<string, unknown>
    decision: Decision
    occurredAt: Date
  }): Promise<{ actionId: string; auditId: string }> {
    const actionId = randomUUID()
    const auditId = randomUUID()

    await prisma.$transaction([
      prisma.action.create({
        data: {
          id: actionId,
          paymentAttemptId: input.paymentAttemptId,
          type: input.type as 'retry_charge',
          status: 'executing',
          scheduledFor: input.scheduledFor,
          idempotencyKey: input.idempotencyKey,
          payload: asJson(input.payload),
        },
      }),
      prisma.auditLog.create({
        data: {
          id: auditId,
          paymentAttemptId: input.paymentAttemptId,
          actionId,
          event: 'action_executed',
          inputSnapshot: asJson({
            rootCause: input.decision.rootCause,
            action: input.type,
            scheduledFor: input.scheduledFor?.toISOString() ?? null,
            idempotencyKey: input.idempotencyKey,
          }),
          ruleFired: `${input.decision.rootCause} playbook`,
          reasoning: input.decision.evidence.at(-1) ?? null,
          occurredAt: input.occurredAt,
        },
      }),
    ])

    return { actionId, auditId }
  }

  async closeAction(input: {
    actionId: string
    auditId: string
    result: ExecutionResult
    occurredAt: Date
  }): Promise<void> {
    await prisma.$transaction([
      prisma.action.update({
        where: { id: input.actionId },
        data: {
          status: input.result.status === 'accepted' ? 'succeeded' : 'failed',
          executedAt: input.occurredAt,
          outcome: asJson(input.result),
        },
      }),
      prisma.auditLog.update({
        where: { id: input.auditId },
        data: { reasoning: JSON.stringify(input.result).slice(0, 2000) },
      }),
    ])
  }

  async recordVeto(input: {
    paymentAttemptId: string
    decision: Decision
    occurredAt: Date
  }): Promise<void> {
    const verdict = input.decision.guardrailVerdict
    if (verdict.allowed) return
    const action = input.decision.proposedAction
    if (action === null) return

    const existing = await prisma.action.findUnique({
      where: { idempotencyKey: action.idempotencyKey },
      select: { id: true },
    })

    const actionId = existing?.id ?? randomUUID()

    const writes: Prisma.PrismaPromise<unknown>[] = []

    if (existing === null) {
      writes.push(
        prisma.action.create({
          data: {
            id: actionId,
            paymentAttemptId: input.paymentAttemptId,
            type: action.type,
            status: 'vetoed',
            scheduledFor: action.scheduledFor,
            idempotencyKey: action.idempotencyKey,
            payload: asJson(action.payload),
            vetoedBy: verdict.vetoedBy,
            vetoReason: verdict.reason,
          },
        }),
      )
    }

    writes.push(
      prisma.auditLog.create({
        data: {
          paymentAttemptId: input.paymentAttemptId,
          actionId,
          event: 'action_vetoed',
          inputSnapshot: asJson({ action: action.type, rootCause: input.decision.rootCause }),
          ruleFired: verdict.vetoedBy,
          reasoning: verdict.reason,
          occurredAt: input.occurredAt,
        },
      }),
    )

    await prisma.$transaction(writes)
  }
}

export async function loadOracle(
  razorpayPaymentId: string,
): Promise<{ failedAt: Date; oracle: RecoverabilityOracle } | null> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { razorpayPaymentId },
    select: { failedAt: true, recoverableUnder: true },
  })
  if (row === null || row.recoverableUnder === null) return null

  const parsed = recoverabilityOracleSchema.safeParse(row.recoverableUnder)
  if (!parsed.success) return null

  return { failedAt: row.failedAt, oracle: parsed.data }
}

export async function resetBatchState(paymentAttemptIds: readonly string[]): Promise<void> {
  const ids = [...paymentAttemptIds]
  await prisma.auditLog.deleteMany({ where: { paymentAttemptId: { in: ids } } })
  await prisma.action.deleteMany({ where: { paymentAttemptId: { in: ids } } })
  await prisma.diagnosis.deleteMany({ where: { paymentAttemptId: { in: ids } } })
  await prisma.paymentAttempt.updateMany({
    where: { id: { in: ids } },
    data: { status: 'failed' },
  })
}
