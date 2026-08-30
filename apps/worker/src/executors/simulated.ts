import {
  oracleAllows,
  type ActionExecutor,
  type ChargeOutcome,
  type ChargeOutcomeAdapter,
  type ExecutionRequest,
  type ExecutionResult,
  type Intervention,
  type RecoverabilityOracle,
} from '@revenue/core'
import type { Channel } from './mockChannel.js'

export interface OracleSource {
  load(paymentId: string): Promise<{ failedAt: Date; oracle: RecoverabilityOracle } | null>
}

export interface SimulatedExecutorDeps {
  oracles: OracleSource
  onOutcome: (outcome: ChargeOutcome) => Promise<void>
  channel: Channel
}

async function resolveThroughOracle(
  deps: SimulatedExecutorDeps,
  request: ExecutionRequest,
  intervention: Intervention,
  providerRef: string,
): Promise<boolean> {
  const facts = await deps.oracles.load(request.paymentId)
  if (facts === null) return false

  const recovered = oracleAllows(
    facts.oracle,
    intervention,
    facts.failedAt,
    request.attemptedAt,
  )

  await deps.onOutcome(
    recovered
      ? {
          status: 'succeeded',
          paymentId: request.paymentId,
          providerRef,
          amountPaise: request.amountPaise,
          settledAt: request.attemptedAt,
          source: 'simulated',
        }
      : {
          status: 'failed',
          paymentId: request.paymentId,
          providerRef,
          failure: {
            code: 'BAD_REQUEST_ERROR',
            description: 'The payment failed.',
            source: 'bank',
            step: 'payment_authorization',
            reason: 'payment_failed',
          },
          settledAt: request.attemptedAt,
          source: 'simulated',
        },
  )

  return recovered
}

export class RetryChargeExecutor implements ActionExecutor {
  readonly type = 'retry_charge' as const

  constructor(private readonly adapter: ChargeOutcomeAdapter) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const ack = await this.adapter.attemptCharge({
      paymentId: request.paymentId,
      idempotencyKey: request.action.idempotencyKey,
      amountPaise: request.amountPaise,
      method: request.method,
      attemptedAt: request.attemptedAt,
    })

    if (!ack.accepted) {
      return { status: 'rejected', code: ack.rejection.code, message: ack.rejection.message }
    }

    return {
      status: 'accepted',
      providerRef: ack.providerRef,
      detail: { adapter: this.adapter.kind },
    }
  }
}

export class IssuePaymentLinkExecutor implements ActionExecutor {
  readonly type = 'issue_payment_link' as const

  constructor(private readonly deps: SimulatedExecutorDeps) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const providerRef = `link_${request.action.idempotencyKey}`
    const url = `https://rzp.test/l/${encodeURIComponent(providerRef)}`

    const recovered = await resolveThroughOracle(
      this.deps,
      request,
      'issue_payment_link',
      providerRef,
    )

    return { status: 'accepted', providerRef, detail: { url, recovered } }
  }
}

export class SendNudgeExecutor implements ActionExecutor {
  readonly type = 'send_nudge' as const

  constructor(private readonly deps: SimulatedExecutorDeps) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const providerRef = `nudge_${request.action.idempotencyKey}`
    const includeLink = request.action.payload['includeLink'] === true
    const copyHint = String(request.action.payload['copyHint'] ?? '')

    const { messageRef } = await this.deps.channel.send({
      paymentId: request.paymentId,
      customerId: request.action.idempotencyKey.split(':')[0] ?? request.paymentId,
      body: copyHint,
      includeLink,
      link: includeLink ? `https://rzp.test/l/${encodeURIComponent(providerRef)}` : null,
      sentAt: request.attemptedAt,
    })

    const recovered = await resolveThroughOracle(this.deps, request, 'send_nudge', providerRef)

    return { status: 'accepted', providerRef, detail: { messageRef, recovered } }
  }
}

export class EscalateExecutor implements ActionExecutor {
  readonly type = 'escalate' as const

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return {
      status: 'accepted',
      providerRef: null,
      detail: { queuedFor: 'human_review', payload: request.action.payload },
    }
  }
}
