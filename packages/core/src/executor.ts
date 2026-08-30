import type { ActionType, PaymentMethod, Paise, ProposedAction } from './types.js'

export interface ExecutionRequest {
  paymentId: string
  action: ProposedAction
  amountPaise: Paise
  method: PaymentMethod
  failedAt: Date
  attemptedAt: Date
}

export type ExecutionResult =
  | { status: 'accepted'; providerRef: string | null; detail: Record<string, unknown> }
  | { status: 'rejected'; code: string; message: string }

export interface ActionExecutor {
  readonly type: ActionType
  execute(request: ExecutionRequest): Promise<ExecutionResult>
}

export type ExecutorRegistry = Readonly<Record<ActionType, ActionExecutor>>

export function selectExecutor(
  registry: ExecutorRegistry,
  type: ActionType,
): ActionExecutor {
  const executor = registry[type]
  if (executor === undefined) {
    throw new Error(`no executor registered for action type ${type}`)
  }
  return executor
}
