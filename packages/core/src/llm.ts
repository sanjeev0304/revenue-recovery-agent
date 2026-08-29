import { z } from 'zod'
import { rootCauseSchema, type PaymentFacts, type RootCause } from './types.js'

export const llmDiagnosisSchema = z.object({
  rootCause: rootCauseSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(2000),
})
export type LlmDiagnosis = z.infer<typeof llmDiagnosisSchema>

export const llmCopySchema = z.object({
  body: z.string().min(1).max(480),
})
export type LlmCopy = z.infer<typeof llmCopySchema>

export interface LLMProvider {
  readonly model: string
  complete(prompt: string): Promise<string>
}

export type LlmParse<T> =
  | { ok: true; value: T; raw: string }
  | { ok: false; error: string; raw: string }

export function parseLlmDiagnosis(raw: string): LlmParse<LlmDiagnosis> {
  let json: unknown
  try {
    json = JSON.parse(stripCodeFence(raw))
  } catch {
    return { ok: false, error: 'response was not valid JSON', raw }
  }

  const parsed = llmDiagnosisSchema.safeParse(json)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; '), raw }
  }
  return { ok: true, value: parsed.data, raw }
}

export function parseLlmCopy(raw: string): LlmParse<LlmCopy> {
  let json: unknown
  try {
    json = JSON.parse(stripCodeFence(raw))
  } catch {
    return { ok: false, error: 'response was not valid JSON', raw }
  }
  const parsed = llmCopySchema.safeParse(json)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; '), raw }
  }
  return { ok: true, value: parsed.data, raw }
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
}

const CANDIDATE_CAUSES: readonly RootCause[] = [
  'INSUFFICIENT_FUNDS',
  'TRANSACTION_LIMIT_EXCEEDED',
  'AUTH_FAILED',
  'CUSTOMER_ABANDONED',
  'ISSUER_DOWNTIME',
  'GATEWAY_DOWNTIME',
  'INSTRUMENT_INVALID',
  'RISK_DECLINE',
  'OPAQUE_BANK_DECLINE',
  'TECHNICAL_UNRESOLVED',
  'UNKNOWN',
]

export interface DiagnosisPromptInput {
  payment: PaymentFacts
  localHour: number
  priorAttempts: number
  priorReasons: readonly string[]
}

export function buildDiagnosisPrompt(input: DiagnosisPromptInput): string {
  const { payment } = input
  return [
    'You are classifying why an Indian online payment failed.',
    'The gateway did not tell us the underlying cause, so infer the most likely one.',
    '',
    'Facts:',
    `- method: ${payment.method}`,
    `- amount: ${payment.amountPaise} paise`,
    `- gateway reason: ${payment.failure.reason ?? 'none given'}`,
    `- gateway source: ${payment.failure.source ?? 'unknown'}`,
    `- gateway step: ${payment.failure.step ?? 'unknown'}`,
    `- local hour of attempt: ${input.localHour}`,
    `- prior failed attempts for this payment: ${input.priorAttempts}`,
    `- prior reasons seen: ${input.priorReasons.length > 0 ? input.priorReasons.join(', ') : 'none'}`,
    '',
    `Choose exactly one rootCause from: ${CANDIDATE_CAUSES.join(', ')}.`,
    'Use UNKNOWN only when the evidence genuinely does not favour any cause.',
    'Never choose RISK_DECLINE unless the evidence explicitly indicates a risk check.',
    '',
    'Respond with JSON only, no prose and no code fence:',
    '{"rootCause": "...", "confidence": 0.0, "reasoning": "one or two sentences"}',
  ].join('\n')
}

export function fallbackDiagnosis(error: string): LlmDiagnosis {
  return {
    rootCause: 'UNKNOWN',
    confidence: 0,
    reasoning: `LLM response rejected: ${error}`,
  }
}
