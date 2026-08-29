import type {
  ChargeAck,
  ChargeOutcomeAdapter,
  ChargeRequest,
} from '@revenue/core'

export interface RazorpayAdapterConfig {
  keyId: string
  keySecret: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export class RazorpayAdapter implements ChargeOutcomeAdapter {
  readonly kind = 'razorpay' as const

  private readonly baseUrl: string
  private readonly auth: string
  private readonly fetchImpl: typeof fetch

  constructor(config: RazorpayAdapterConfig) {
    if (!config.keyId.startsWith('rzp_test_')) {
      throw new Error('RazorpayAdapter refuses any key id that is not rzp_test_ prefixed')
    }
    this.baseUrl = config.baseUrl ?? 'https://api.razorpay.com/v1'
    this.auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async attemptCharge(request: ChargeRequest): Promise<ChargeAck> {
    const response = await this.fetchImpl(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${this.auth}`,
        'content-type': 'application/json',
        'x-razorpay-idempotency-key': request.idempotencyKey,
      },
      body: JSON.stringify({
        amount: request.amountPaise,
        currency: 'INR',
        receipt: request.idempotencyKey,
        notes: { paymentId: request.paymentId, attempt: 'recovery' },
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return {
        accepted: false,
        rejection: {
          code: `http_${response.status}`,
          message: detail.slice(0, 300),
        },
        attemptedAt: request.attemptedAt,
      }
    }

    const body = (await response.json()) as { id?: unknown }
    if (typeof body.id !== 'string' || body.id.length === 0) {
      return {
        accepted: false,
        rejection: { code: 'malformed_response', message: 'order response had no id' },
        attemptedAt: request.attemptedAt,
      }
    }

    return { accepted: true, providerRef: body.id, attemptedAt: request.attemptedAt }
  }
}
