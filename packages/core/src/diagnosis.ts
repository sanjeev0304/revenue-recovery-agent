import type { ClassifierKind, Diagnosis, PaymentFacts, RootCause } from './types.js'
import { LLM_CLASSIFIED_CAUSES, lookupReason } from './taxonomy.js'
import type { LlmDiagnosis } from './llm.js'

export type DeterministicOutcome =
  | { kind: 'resolved'; diagnosis: Diagnosis }
  | { kind: 'needs_llm'; provisional: RootCause; evidence: string[] }

export function classify(facts: PaymentFacts): DeterministicOutcome {
  const reason = facts.failure.reason
  const evidence: string[] = []

  if (facts.failure.code !== null) {
    evidence.push(`code=${facts.failure.code} (not used for classification)`)
  }
  evidence.push(`method=${facts.method}`)

  if (reason === null || reason === '') {
    evidence.push('no reason supplied by gateway')
    return { kind: 'needs_llm', provisional: 'UNKNOWN', evidence }
  }

  evidence.push(`reason=${reason}`)
  if (facts.failure.source !== null) evidence.push(`source=${facts.failure.source}`)
  if (facts.failure.step !== null) evidence.push(`step=${facts.failure.step}`)

  const mapping = lookupReason(reason)

  if (mapping === undefined) {
    evidence.push(`reason "${reason}" is not in the taxonomy`)
    return { kind: 'needs_llm', provisional: 'UNKNOWN', evidence }
  }

  if (!mapping.methods.includes(facts.method)) {
    evidence.push(`reason "${reason}" is not valid for method ${facts.method}`)
    return { kind: 'needs_llm', provisional: 'UNKNOWN', evidence }
  }

  evidence.push(`taxonomy maps "${reason}" to ${mapping.rootCause}`)

  if (LLM_CLASSIFIED_CAUSES.includes(mapping.rootCause)) {
    evidence.push('bank gave no underlying cause, deferring to the model')
    return { kind: 'needs_llm', provisional: mapping.rootCause, evidence }
  }

  return {
    kind: 'resolved',
    diagnosis: {
      rootCause: mapping.rootCause,
      confidence: 1,
      classifier: 'deterministic',
      evidence,
    },
  }
}

export function applyLlmDiagnosis(
  outcome: Extract<DeterministicOutcome, { kind: 'needs_llm' }>,
  llm: LlmDiagnosis,
): Diagnosis {
  const classifier: ClassifierKind = 'llm'
  const evidence = [...outcome.evidence, `model predicted ${llm.rootCause}: ${llm.reasoning}`]

  if (llm.rootCause === 'UNKNOWN') {
    return {
      rootCause: outcome.provisional,
      confidence: llm.confidence,
      classifier,
      evidence: [...evidence, `model declined to refine, holding ${outcome.provisional}`],
    }
  }

  return { rootCause: llm.rootCause, confidence: llm.confidence, classifier, evidence }
}

export function cacheKey(facts: PaymentFacts): string {
  return [
    facts.method,
    facts.failure.reason ?? 'null',
    facts.failure.source ?? 'null',
    facts.failure.step ?? 'null',
  ].join('|')
}

export function requiresLlm(facts: PaymentFacts): boolean {
  return classify(facts).kind === 'needs_llm'
}
