import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'x-razorpay-signature'
export const EVENT_ID_HEADER = 'x-razorpay-event-id'

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing_signature' | 'malformed_signature' | 'mismatch' }

export function verifyWebhookSignature(
  rawBody: Buffer,
  header: unknown,
  secret: string,
): VerifyResult {
  if (typeof header !== 'string' || header.length === 0) {
    return { ok: false, reason: 'missing_signature' }
  }

  if (!/^[0-9a-f]+$/i.test(header)) {
    return { ok: false, reason: 'malformed_signature' }
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const received = Buffer.from(header, 'hex')

  if (received.length !== expected.length) {
    return { ok: false, reason: 'malformed_signature' }
  }

  return timingSafeEqual(received, expected) ? { ok: true } : { ok: false, reason: 'mismatch' }
}

export function signPayload(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function eventIdFor(header: unknown, rawBody: Buffer): string {
  if (typeof header === 'string' && header.length > 0) return header
  return `sha256:${createHash('sha256').update(rawBody).digest('hex')}`
}
