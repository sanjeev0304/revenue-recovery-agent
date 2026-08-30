import {
  applyLlmDiagnosis,
  buildDiagnosisPrompt,
  cacheKey,
  classify,
  fallbackDiagnosis,
  localParts,
  parseLlmDiagnosis,
  type Diagnosis,
  type LLMProvider,
  type LlmDiagnosis,
  type PaymentFacts,
  type RecentFailureWindow,
} from '@revenue/core'

export interface DiagnoseDeps {
  provider: LLMProvider | null
  cache?: Map<string, LlmDiagnosis>
  timezone?: string
  burstFor?: (facts: PaymentFacts) => RecentFailureWindow | undefined
}

export interface DiagnoseStats {
  total: number
  deterministic: number
  llmResolved: number
  cacheHits: number
  apiCalls: number
  parseFailures: number
}

export function createDiagnoser(deps: DiagnoseDeps): {
  diagnose: (facts: PaymentFacts) => Promise<Diagnosis>
  stats: DiagnoseStats
} {
  const cache = deps.cache ?? new Map<string, LlmDiagnosis>()
  const stats: DiagnoseStats = {
    total: 0,
    deterministic: 0,
    llmResolved: 0,
    cacheHits: 0,
    apiCalls: 0,
    parseFailures: 0,
  }

  async function diagnose(facts: PaymentFacts): Promise<Diagnosis> {
    stats.total++
    const outcome = classify(facts)

    if (outcome.kind === 'resolved') {
      stats.deterministic++
      return outcome.diagnosis
    }

    stats.llmResolved++
    const key = cacheKey(facts)
    const cached = cache.get(key)

    if (cached !== undefined) {
      stats.cacheHits++
      return applyLlmDiagnosis(outcome, cached)
    }

    if (deps.provider === null) {
      return applyLlmDiagnosis(
        outcome,
        fallbackDiagnosis('no LLM provider configured'),
      )
    }

    const tz = deps.timezone ?? 'Asia/Kolkata'
    const parts = localParts(facts.failedAt, tz)

    const prompt = buildDiagnosisPrompt({
      payment: facts,
      localHour: parts.hour,
      localDayOfMonth: parts.day,
      priorAttempts: facts.attemptNumber - 1,
      priorReasons: facts.failure.reason === null ? [] : [facts.failure.reason],
      ...(deps.burstFor?.(facts) === undefined ? {} : { burst: deps.burstFor(facts)! }),
    })

    stats.apiCalls++

    let llm: LlmDiagnosis
    try {
      const raw = await deps.provider.complete(prompt)
      const parsed = parseLlmDiagnosis(raw)
      if (parsed.ok) {
        llm = parsed.value
      } else {
        stats.parseFailures++
        llm = fallbackDiagnosis(parsed.error)
      }
    } catch (err) {
      stats.parseFailures++
      llm = fallbackDiagnosis((err as Error).message.slice(0, 200))
    }

    cache.set(key, llm)
    return applyLlmDiagnosis(outcome, llm)
  }

  return { diagnose, stats }
}
