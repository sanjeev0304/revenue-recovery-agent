import { decide, type Decision, type PolicyInput } from '@revenue/core'
import type { Clock } from '../clock.js'

export interface RecoveryJob {
  paymentAttemptId: string
}

export type DecisionContext = Omit<PolicyInput, 'now'>

export interface ScheduleRequest {
  paymentAttemptId: string
  delayMs: number
  runAt: Date
  idempotencyKey: string
}

export interface OrchestratorDeps {
  clock: Clock
  loadContext(paymentAttemptId: string): Promise<DecisionContext | null>
  persistDecision(input: {
    decision: Decision
    occurredAt: Date
    clockKind: Clock['kind']
  }): Promise<void>
  schedule(request: ScheduleRequest): Promise<void>
}

export type HandlerResult =
  | { status: 'unknown_payment' }
  | { status: 'decided'; decision: Decision; scheduled: ScheduleRequest | null }

export async function handleRecoveryJob(
  deps: OrchestratorDeps,
  job: RecoveryJob,
): Promise<HandlerResult> {
  const now = deps.clock.now()

  const context = await deps.loadContext(job.paymentAttemptId)
  if (context === null) {
    return { status: 'unknown_payment' }
  }

  const decision = decide({ ...context, now })

  await deps.persistDecision({ decision, occurredAt: now, clockKind: deps.clock.kind })

  const action = decision.proposedAction
  if (
    !decision.guardrailVerdict.allowed ||
    action === null ||
    decision.scheduledFor === null
  ) {
    return { status: 'decided', decision, scheduled: null }
  }

  const request: ScheduleRequest = {
    paymentAttemptId: job.paymentAttemptId,
    delayMs: deps.clock.delayUntil(decision.scheduledFor),
    runAt: decision.scheduledFor,
    idempotencyKey: action.idempotencyKey,
  }

  await deps.schedule(request)

  return { status: 'decided', decision, scheduled: request }
}
