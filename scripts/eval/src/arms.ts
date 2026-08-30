import {
  classify,
  type ClassifierKind,
  type Diagnosis,
  type EvalArm,
  type RootCause,
} from '@revenue/core'
import { createDiagnoser, GeminiProvider, type DiagnoseStats } from '@revenue/worker/llm'
import {
  newContext,
  simulateAgent,
  simulateBaseline,
  type EvalRecord,
  type RecordOutcome,
} from './simulate.js'

export interface RecordResult {
  record: EvalRecord
  predicted: RootCause | null
  confidence: number
  classifier: ClassifierKind | null
  outcome: RecordOutcome
}

export interface ArmResult {
  key: string
  label: string
  arm: EvalArm
  llmEnabled: boolean
  reported: boolean
  results: RecordResult[]
  diagnosisStats: DiagnoseStats | null
}

function substituted(record: EvalRecord, rootCause: RootCause): Diagnosis {
  const outcome = classify(record.facts)
  const classifier: ClassifierKind = outcome.kind === 'resolved' ? 'deterministic' : 'llm'
  const evidence =
    outcome.kind === 'resolved' ? outcome.diagnosis.evidence : outcome.evidence

  return { rootCause, confidence: 1, classifier, evidence }
}

export function runBaselineArm(records: readonly EvalRecord[]): ArmResult {
  return {
    key: 'baseline',
    label: 'baseline (naive retry)',
    arm: 'baseline',
    llmEnabled: false,
    reported: true,
    diagnosisStats: null,
    results: records.map((record) => ({
      record,
      predicted: null,
      confidence: 0,
      classifier: null,
      outcome: simulateBaseline(record),
    })),
  }
}

export async function runAgentArm(options: {
  records: readonly EvalRecord[]
  llmEnabled: boolean
  apiKey: string
  model: string
  maxSteps: number
  onProgress?: (done: number, total: number) => void
}): Promise<ArmResult> {
  const provider = options.llmEnabled
    ? new GeminiProvider({ apiKey: options.apiKey, model: options.model })
    : null

  const { diagnose, stats } = createDiagnoser({ provider })
  const ctx = newContext(options.maxSteps)
  const results: RecordResult[] = []

  let done = 0
  for (const record of options.records) {
    const diagnosis = await diagnose(record.facts)
    results.push({
      record,
      predicted: diagnosis.rootCause,
      confidence: diagnosis.confidence,
      classifier: diagnosis.classifier,
      outcome: simulateAgent(record, diagnosis, ctx),
    })
    done++
    options.onProgress?.(done, options.records.length)
  }

  return {
    key: options.llmEnabled ? 'agent' : 'agent_no_llm',
    label: options.llmEnabled ? 'agent (LLM on)' : 'agent (LLM off)',
    arm: 'agent',
    llmEnabled: options.llmEnabled,
    reported: true,
    results,
    diagnosisStats: stats,
  }
}

export function runMajorityClassArm(
  records: readonly EvalRecord[],
  majorityCause: RootCause,
  maxSteps: number,
): ArmResult {
  const ctx = newContext(maxSteps)

  return {
    key: 'majority_class',
    label: `majority class (always ${majorityCause})`,
    arm: 'majority_class',
    llmEnabled: false,
    reported: true,
    diagnosisStats: null,
    results: records.map((record) => {
      const outcome = classify(record.facts)
      const rootCause =
        outcome.kind === 'resolved' ? outcome.diagnosis.rootCause : majorityCause
      const diagnosis = substituted(record, rootCause)
      return {
        record,
        predicted: rootCause,
        confidence: diagnosis.confidence,
        classifier: diagnosis.classifier,
        outcome: simulateAgent(record, diagnosis, ctx),
      }
    }),
  }
}

export function runOracleArm(records: readonly EvalRecord[], maxSteps: number): ArmResult {
  const ctx = newContext(maxSteps)

  return {
    key: 'oracle',
    label: 'oracle (knew the true cause)',
    arm: 'agent',
    llmEnabled: false,
    reported: false,
    diagnosisStats: null,
    results: records.map((record) => {
      const diagnosis = substituted(record, record.trueCause)
      return {
        record,
        predicted: record.trueCause,
        confidence: diagnosis.confidence,
        classifier: diagnosis.classifier,
        outcome: simulateAgent(record, diagnosis, ctx),
      }
    }),
  }
}

export type { RecordOutcome }
