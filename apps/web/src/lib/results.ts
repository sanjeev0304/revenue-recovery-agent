import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'

const causeBucket = z.object({
  total: z.number(),
  recovered: z.number(),
  totalPaise: z.number(),
  recoveredPaise: z.number(),
})

const armMetrics = z.object({
  key: z.string(),
  label: z.string(),
  arm: z.string(),
  llmEnabled: z.boolean(),
  processed: z.number(),
  recovered: z.number(),
  recoveredPaise: z.number(),
  totalPaise: z.number(),
  chargeAttempts: z.number(),
  wastedChargeAttempts: z.number(),
  contacts: z.number(),
  linksIssued: z.number(),
  escalated: z.number(),
  vetoed: z.number(),
  vetoedBy: z.record(z.string(), z.number()),
  quietHoursViolations: z.number(),
  operationalCostPaise: z.number(),
  byCause: z.record(z.string(), causeBucket),
})

const perClass = z.object({
  cause: z.string(),
  support: z.number(),
  predicted: z.number(),
  tp: z.number(),
  fp: z.number(),
  fn: z.number(),
})

const classificationMetrics = z.object({
  total: z.number(),
  correct: z.number(),
  llmClassified: z.number(),
  perClass: z.array(perClass),
})

const subsetAccuracy = z.object({ total: z.number(), correct: z.number() })

const opaqueSubset = z.object({
  majorityCause: z.string(),
  majorityCount: z.number(),
  all: subsetAccuracy,
  genuine: subsetAccuracy,
  masked: subsetAccuracy,
  maskedInBurst: subsetAccuracy,
  maskedScattered: subsetAccuracy,
})

const matrixCell = z.object({
  predicted: z.string(),
  trueCause: z.string(),
  n: z.number(),
  recoveredPaise: z.number(),
  oracleRecoveredPaise: z.number(),
  shortfallPaise: z.number(),
  chargeAttempts: z.number(),
  wastedChargeAttempts: z.number(),
  contacts: z.number(),
  costPaise: z.number(),
})

const llmComparison = z.object({
  recoveredOn: z.number(),
  recoveredOff: z.number(),
  recoveredPaiseOn: z.number(),
  recoveredPaiseOff: z.number(),
  correctOn: z.number(),
  correctOff: z.number(),
  classifiedTotal: z.number(),
  wastedOn: z.number(),
  wastedOff: z.number(),
  chargeAttemptsOn: z.number(),
  chargeAttemptsOff: z.number(),
  llmHitRate: z.object({ calls: z.number(), total: z.number() }),
})

export const evalResultsSchema = z.object({
  generatedAt: z.string(),
  datasetVersion: z.string(),
  split: z.string(),
  recordCount: z.number(),
  skipped: z.number(),
  costAssumptions: z.array(z.string()),
  arms: z.array(armMetrics),
  oracle: armMetrics,
  classification: z.record(z.string(), classificationMetrics),
  opaque: z.record(z.string(), opaqueSubset),
  confusion: z.array(matrixCell),
  llmComparison,
  caveats: z.array(z.string()),
})

export type EvalResults = z.infer<typeof evalResultsSchema>
export type ArmMetrics = z.infer<typeof armMetrics>
export type MatrixCell = z.infer<typeof matrixCell>
export type OpaqueSubsetView = z.infer<typeof opaqueSubset>

export type ResultsState =
  | { kind: 'ok'; results: EvalResults }
  | { kind: 'missing' }
  | { kind: 'invalid'; error: string }

export async function loadResults(): Promise<ResultsState> {
  const path = resolve(process.cwd(), '../../docs/results.json')

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { kind: 'missing' }
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { kind: 'invalid', error: 'results.json is not valid JSON' }
  }

  const parsed = evalResultsSchema.safeParse(json)
  if (!parsed.success) {
    return {
      kind: 'invalid',
      error: parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    }
  }

  return { kind: 'ok', results: parsed.data }
}
