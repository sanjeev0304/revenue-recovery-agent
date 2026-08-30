import type {
  ArmMetrics,
  ClassificationMetrics,
  MatrixCell,
  OpaqueSubset,
} from './metrics.js'

export interface LlmComparison {
  on: string
  off: string
  recoveredOn: number
  recoveredOff: number
  recoveredPaiseOn: number
  recoveredPaiseOff: number
  correctOn: number
  correctOff: number
  classifiedTotal: number
  wastedOn: number
  wastedOff: number
  chargeAttemptsOn: number
  chargeAttemptsOff: number
  llmHitRate: { calls: number; total: number }
}

export interface EvalResults {
  generatedAt: string
  datasetVersion: string
  split: string
  recordCount: number
  skipped: number
  costAssumptions: readonly string[]
  arms: ArmMetrics[]
  oracle: ArmMetrics
  classification: Record<string, ClassificationMetrics>
  opaque: Record<string, OpaqueSubset>
  confusion: MatrixCell[]
  llmComparison: LlmComparison
  caveats: readonly string[]
}

export const CAVEATS = [
  'The dataset is synthetic. Every number here is measured against `recoverableUnder`, a ground-truth oracle the generator derived from each record\'s true cause. See docs/EVAL-PLAN.md for how it was modelled.',
  'Contact interventions are scored on a 72h response horizon, not on timing. That semantic choice accounts for roughly two thirds of the agent\'s recovery lift. See docs/DECISIONS.md, "Contact interventions are scored on a response horizon".',
  'The salary-window retry rule targets the same 1st and last-working-day window the generator used to plant funds-arrival delays. Its measured benefit is partly an artefact of that shared assumption.',
  'Downtime classes are structurally identifiable, not inferred: a burst of sibling failures with an identical gateway reason points straight at the cause. Downtime accuracy should not carry the headline.',
  'The majority-class arm is scored with the same classifier kind and a confidence of 1, so cap-halving and the confidence floor behave exactly as they do in the agent arm. The only difference between the two arms is the predicted label.',
  'A guardrail veto ends the payment rather than deferring the action past the blocking condition. A contact vetoed by QUIET_HOURS is therefore never re-attempted at 09:00. This is the orchestrator\'s behaviour, mirrored here, and it makes the agent\'s recovery number conservative.',
  'Per-attempt and per-message costs are declared constants, not measurements.',
] as const
