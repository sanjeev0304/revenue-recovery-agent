import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { eventIdFor, signPayload, verifyWebhookSignature } from './signature.js'

const SECRET = 'whsec_test_abc123'
const BODY = Buffer.from(
  JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_1' } } } }),
)

describe('verifyWebhookSignature', () => {
  it('accepts a known-good HMAC computed independently', () => {
    const expected = createHmac('sha256', SECRET).update(BODY).digest('hex')
    expect(expected).toHaveLength(64)
    expect(verifyWebhookSignature(BODY, expected, SECRET)).toEqual({ ok: true })
  })

  it('accepts the signature produced by signPayload', () => {
    expect(verifyWebhookSignature(BODY, signPayload(BODY, SECRET), SECRET).ok).toBe(true)
  })

  it('rejects a tampered body under the original signature', () => {
    const sig = signPayload(BODY, SECRET)
    const tampered = Buffer.from(BODY.toString().replace('pay_1', 'pay_2'))
    expect(verifyWebhookSignature(tampered, sig, SECRET)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('rejects a single flipped byte in the body', () => {
    const sig = signPayload(BODY, SECRET)
    const tampered = Buffer.from(BODY)
    tampered[10] = tampered[10]! ^ 0x01
    expect(verifyWebhookSignature(tampered, sig, SECRET).ok).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    const sig = signPayload(BODY, 'whsec_wrong')
    expect(verifyWebhookSignature(BODY, sig, SECRET)).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('rejects a missing or empty header', () => {
    expect(verifyWebhookSignature(BODY, undefined, SECRET).ok).toBe(false)
    expect(verifyWebhookSignature(BODY, '', SECRET)).toEqual({
      ok: false,
      reason: 'missing_signature',
    })
    expect(verifyWebhookSignature(BODY, 12345, SECRET)).toEqual({
      ok: false,
      reason: 'missing_signature',
    })
  })

  it('rejects non-hex without letting Buffer.from truncate it silently', () => {
    const sig = signPayload(BODY, SECRET)
    const notHex = `zz${sig.slice(2)}`
    expect(verifyWebhookSignature(BODY, notHex, SECRET)).toEqual({
      ok: false,
      reason: 'malformed_signature',
    })
  })

  it('rejects a truncated signature rather than throwing', () => {
    const sig = signPayload(BODY, SECRET)
    expect(verifyWebhookSignature(BODY, sig.slice(0, 40), SECRET)).toEqual({
      ok: false,
      reason: 'malformed_signature',
    })
  })

  it('rejects an over-long signature', () => {
    const sig = signPayload(BODY, SECRET)
    expect(verifyWebhookSignature(BODY, `${sig}00`, SECRET).ok).toBe(false)
  })

  it('is byte-sensitive, so a reserialised body does not verify', () => {
    const sig = signPayload(BODY, SECRET)
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(BODY.toString())) + ' ')
    expect(verifyWebhookSignature(reserialised, sig, SECRET).ok).toBe(false)
  })
})

describe('eventIdFor', () => {
  it('uses the Razorpay event id header when present', () => {
    expect(eventIdFor('evt_abc', BODY)).toBe('evt_abc')
  })

  it('falls back to a body hash so dedupe still has a key', () => {
    const id = eventIdFor(undefined, BODY)
    expect(id.startsWith('sha256:')).toBe(true)
    expect(eventIdFor(undefined, BODY)).toBe(id)
    expect(eventIdFor(undefined, Buffer.from('other'))).not.toBe(id)
  })
})
