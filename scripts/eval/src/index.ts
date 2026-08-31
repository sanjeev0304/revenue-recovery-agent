import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '@revenue/db'
import type { EvalSplit } from '@revenue/core'
import { COST_ASSUMPTIONS } from './cost.js'
import { loadRecords } from './load.js'
import { CACHE_PATH, loadLlmCache, saveLlmCache } from './llmCache.js'
import {
  runAgentArm,
  runBaselineArm,
  runMajorityClassArm,
  runOracleArm,
  type ArmResult,
} from './arms.js'
import {
  aggregate,
  classification,
  costWeightedConfusion,
  majorityCauseOfOpaqueSubset,
  opaqueSubset,
  type ClassificationMetrics,
  type OpaqueSubset,
} from './metrics.js'
import { CAVEATS, type EvalResults } from './results.js'
import { renderMarkdown, rate, rupees } from './report.js'

const flag = (name: string): boolean => process.argv.includes(`--${name}`)
const num = (name: string): number | undefined => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (found === undefined) return undefined
  const value = Number(found.slice(name.length + 3))
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`)
  return value
}

const split: EvalSplit = flag('holdout') ? 'holdout' : 'train'
const limit = num('limit')
const maxSteps = num('max-steps') ?? 6
const persist = !flag('no-persist')
const write = !flag('no-write')

if (split === 'holdout' && !flag('yes-really-holdout')) {
  console.error(
    'The holdout split is frozen. Running it is a one-way door: once read, it is no longer held out.\n' +
      'Re-run with --holdout --yes-really-holdout if that is genuinely what you want.',
  )
  process.exit(1)
}

const apiKey = process.env['GEMINI_API_KEY'] ?? ''
const model = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash'
if (apiKey === '') {
  console.error('GEMINI_API_KEY is not set. The LLM-on arm cannot run without it.')
  process.exit(1)
}

const startedAt = new Date()
const t0 = Date.now()

try {
  const { records, datasetVersion, skipped } = await loadRecords(split, limit)
  if (records.length === 0) throw new Error(`no ${split} records found; run npm run seed first`)

  console.log(`eval: dataset ${datasetVersion}, ${split} split, ${records.length} records`)
  if (skipped > 0) console.log(`  ${skipped} skipped for a missing oracle or true cause`)

  const majority = majorityCauseOfOpaqueSubset(records)
  console.log(
    `  opaque subset ${majority.total} records, majority class ${majority.cause} at ${rate(majority.count, majority.total)}`,
  )
  console.log('')

  console.log('arm 1/5  baseline (naive retry)')
  const baseline = runBaselineArm(records)

  console.log('arm 2/5  agent, LLM off')
  const agentNoLlm = await runAgentArm({
    records,
    llmEnabled: false,
    apiKey,
    model,
    maxSteps,
  })

  const refreshCache = flag('refresh-llm-cache')
  const cache = refreshCache
    ? { map: new Map(), existed: false, entriesOnDisk: 0, modelOnDisk: null }
    : loadLlmCache(model)

  console.log(`arm 3/5  agent, LLM on (${model})`)
  console.log(
    cache.existed
      ? `         replaying ${cache.entriesOnDisk} cached diagnoses from scripts/eval/llm-cache.json`
      : `         no cache on disk${refreshCache ? ' (refresh requested)' : ''}, calling the model`,
  )
  let lastLogged = 0
  const agent = await runAgentArm({
    records,
    llmEnabled: true,
    apiKey,
    model,
    maxSteps,
    cache: cache.map,
    onProgress: (done, total) => {
      if (done - lastLogged >= 100 || done === total) {
        lastLogged = done
        process.stdout.write(`\r         ${done}/${total}`)
        if (done === total) process.stdout.write('\n')
      }
    },
  })

  saveLlmCache(model, cache.map)
  console.log(
    `         cache now holds ${cache.map.size} diagnoses; ${agent.diagnosisStats?.apiCalls ?? 0} live API calls this run`,
  )

  console.log('arm 4/5  majority class')
  const majorityArm = runMajorityClassArm(records, majority.cause, maxSteps)

  console.log('arm 5/5  oracle reference (for the cost-weighted matrix)')
  const oracle = runOracleArm(records, maxSteps)
  console.log('')

  const arms: ArmResult[] = [baseline, agent, majorityArm, agentNoLlm]
  const metrics = arms.map(aggregate)
  const oracleMetrics = aggregate(oracle)

  const classificationByKey: Record<string, ClassificationMetrics> = {}
  const opaqueByKey: Record<string, OpaqueSubset> = {}
  for (const arm of arms) {
    const c = classification(arm)
    if (c !== null) classificationByKey[arm.key] = c
    if (arm.key !== 'baseline') opaqueByKey[arm.key] = opaqueSubset(arm, majority.cause)
  }

  const agentMetrics = metrics.find((m) => m.key === 'agent')!
  const noLlmMetrics = metrics.find((m) => m.key === 'agent_no_llm')!
  const agentClass = classificationByKey['agent']!
  const noLlmClass = classificationByKey['agent_no_llm']!

  const results: EvalResults = {
    generatedAt: startedAt.toISOString(),
    datasetVersion,
    split,
    recordCount: records.length,
    skipped,
    costAssumptions: COST_ASSUMPTIONS,
    arms: metrics,
    oracle: oracleMetrics,
    classification: classificationByKey,
    opaque: opaqueByKey,
    confusion: costWeightedConfusion(agent, oracle),
    llmComparison: {
      on: 'agent',
      off: 'agent_no_llm',
      recoveredOn: agentMetrics.recovered,
      recoveredOff: noLlmMetrics.recovered,
      recoveredPaiseOn: agentMetrics.recoveredPaise,
      recoveredPaiseOff: noLlmMetrics.recoveredPaise,
      correctOn: agentClass.correct,
      correctOff: noLlmClass.correct,
      classifiedTotal: agentClass.total,
      wastedOn: agentMetrics.wastedChargeAttempts,
      wastedOff: noLlmMetrics.wastedChargeAttempts,
      chargeAttemptsOn: agentMetrics.chargeAttempts,
      chargeAttemptsOff: noLlmMetrics.chargeAttempts,
      llmHitRate: { calls: agentClass.llmClassified, total: agentClass.total },
    },
    caveats: CAVEATS,
  }

  const root = resolve(import.meta.dirname, '../../..')
  if (write) {
    await writeFile(resolve(root, 'docs/results.md'), renderMarkdown(results), 'utf8')
    await writeFile(
      resolve(root, 'docs/results.json'),
      `${JSON.stringify(results, null, 2)}\n`,
      'utf8',
    )
    console.log('wrote docs/results.md and docs/results.json')
  }

  if (persist) {
    const finishedAt = new Date()
    for (const m of metrics) {
      await prisma.evalRun.create({
        data: {
          startedAt,
          finishedAt,
          datasetVersion,
          splitName: split,
          arm: m.arm,
          llmEnabled: m.llmEnabled,
          metrics: JSON.parse(JSON.stringify(m)),
          notes: m.label,
        },
      })
    }
    console.log(`wrote ${metrics.length} EvalRun rows`)
  }

  console.log('')
  for (const m of metrics) {
    console.log(
      `${m.label.padEnd(30)} ${rate(m.recovered, m.processed).padEnd(20)} ${rupees(m.recoveredPaise).padStart(12)}  ${String(m.wastedChargeAttempts).padStart(5)} wasted`,
    )
  }
  console.log('')
  console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`)
} finally {
  await prisma.$disconnect()
}
