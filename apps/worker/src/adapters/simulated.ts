import {
  oracleAllows,
  type ChargeAck,
  type ChargeOutcome,
  type ChargeOutcomeAdapter,
  type ChargeRequest,
  type RecoverabilityOracle,
} from '@revenue/core'

export interface SimulatedPaymentFacts {
  failedAt: Date
  oracle: RecoverabilityOracle
}

export type OracleLoader = (paymentId: string) => Promise<SimulatedPaymentFacts | null>

export interface SimulatedAdapterConfig {
  loadOracle: OracleLoader
  onOutcome: (outcome: ChargeOutcome) => Promise<void>
}

const UNRECOVERED_FAILURE = {
  code: 'BAD_REQUEST_ERROR',
  description: 'The payment failed.',
  source: 'bank',
  step: 'payment_authorization',
  reason: 'payment_failed',
} as const

export class SimulatedAdapter implements ChargeOutcomeAdapter {
  readonly kind = 'simulated' as const

  private readonly loadOracle: OracleLoader
  private readonly onOutcome: (outcome: ChargeOutcome) => Promise<void>

  constructor(config: SimulatedAdapterConfig) {
    this.loadOracle = config.loadOracle
    this.onOutcome = config.onOutcome
  }

  async attemptCharge(request: ChargeRequest): Promise<ChargeAck> {
    const facts = await this.loadOracle(request.paymentId)

    if (facts === null) {
      return {
        accepted: false,
        rejection: {
          code: 'unknown_payment',
          message: `no simulated oracle for ${request.paymentId}`,
        },
        attemptedAt: request.attemptedAt,
      }
    }

    const providerRef = `sim_${request.idempotencyKey}`
    const recovered = oracleAllows(
      facts.oracle,
      'retry_charge',
      facts.failedAt,
      request.attemptedAt,
    )

    const outcome: ChargeOutcome = recovered
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
          failure: { ...UNRECOVERED_FAILURE },
          settledAt: request.attemptedAt,
          source: 'simulated',
        }

    await this.onOutcome(outcome)

    return { accepted: true, providerRef, attemptedAt: request.attemptedAt }
  }
}
