import {
  selectExecutor,
  type Decision,
  type ExecutionResult,
  type ExecutorRegistry,
  type PaymentMethod,
  type Paise,
} from '@revenue/core'

export interface ActionRecordInput {
  paymentAttemptId: string
  type: Decision['proposedAction'] extends null ? never : string
  idempotencyKey: string
  scheduledFor: Date | null
  payload: Record<string, unknown>
  occurredAt: Date
}

export interface ExecutionStore {
  openAction(input: {
    paymentAttemptId: string
    type: string
    idempotencyKey: string
    scheduledFor: Date | null
    payload: Record<string, unknown>
    decision: Decision
    occurredAt: Date
  }): Promise<{ actionId: string; auditId: string }>

  closeAction(input: {
    actionId: string
    auditId: string
    result: ExecutionResult
    occurredAt: Date
  }): Promise<void>

  recordVeto(input: {
    paymentAttemptId: string
    decision: Decision
    occurredAt: Date
  }): Promise<void>
}

export interface ExecuteInput {
  paymentAttemptId: string
  decision: Decision
  amountPaise: Paise
  method: PaymentMethod
  failedAt: Date
  occurredAt: Date
}

export type ExecuteOutput =
  | { executed: false; reason: 'no_action' | 'vetoed' }
  | { executed: true; result: ExecutionResult }

export async function executeDecision(
  deps: { store: ExecutionStore; executors: ExecutorRegistry },
  input: ExecuteInput,
): Promise<ExecuteOutput> {
  const action = input.decision.proposedAction

  if (action === null) {
    return { executed: false, reason: 'no_action' }
  }

  if (!input.decision.guardrailVerdict.allowed) {
    await deps.store.recordVeto({
      paymentAttemptId: input.paymentAttemptId,
      decision: input.decision,
      occurredAt: input.occurredAt,
    })
    return { executed: false, reason: 'vetoed' }
  }

  const { actionId, auditId } = await deps.store.openAction({
    paymentAttemptId: input.paymentAttemptId,
    type: action.type,
    idempotencyKey: action.idempotencyKey,
    scheduledFor: action.scheduledFor,
    payload: action.payload,
    decision: input.decision,
    occurredAt: input.occurredAt,
  })

  let result: ExecutionResult
  try {
    result = await selectExecutor(deps.executors, action.type).execute({
      paymentId: input.decision.paymentId,
      action,
      amountPaise: input.amountPaise,
      method: input.method,
      failedAt: input.failedAt,
      attemptedAt: input.occurredAt,
    })
  } catch (err) {
    result = {
      status: 'rejected',
      code: 'executor_threw',
      message: (err as Error).message.slice(0, 300),
    }
  }

  await deps.store.closeAction({ actionId, auditId, result, occurredAt: input.occurredAt })

  return { executed: true, result }
}
