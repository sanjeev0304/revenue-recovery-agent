import { prisma } from '@revenue/db'
import type { Diagnosis, EvalSplit } from '@revenue/core'
import { loadEvalRecords, runEval, type EvalRecord } from './orchestrator/evalBatch.js'
import { createDiagnoser } from './llm/diagnose.js'
import { GeminiProvider } from './llm/gemini.js'

const flag = (name: string): boolean => process.argv.includes(`--${name}`)
const num = (name: string, fallback: number | undefined): number | undefined => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (found === undefined) return fallback
  return Number(found.slice(name.length + 3))
}

const split: EvalSplit = flag('holdout') ? 'holdout' : 'train'
if (split === 'holdout' && !flag('i-am-scripts-eval')) {
  throw new Error(
    'the holdout split is frozen and may only be read by scripts/eval; refusing',
  )
}

const limit = num('limit', undefined)
const useLlm = !flag('no-llm')

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const started = Date.now()

try {
  const records = await loadEvalRecords(split, limit)
  const loadedAt = Date.now()

  const provider = useLlm
    ? new GeminiProvider({
        apiKey: process.env['GEMINI_API_KEY'] ?? '',
        model: process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash',
      })
    : null

  const { diagnose, stats } = createDiagnoser({ provider })

  const report = await runEval(records, {
    split,
    diagnose: (r: EvalRecord): Promise<Diagnosis> => diagnose(r.facts),
  })

  const totalMs = Date.now() - started
  const perRecord = totalMs / Math.max(report.processed, 1)

  console.log(`eval: ${split} split, ${report.processed} records, llm=${useLlm ? provider!.model : 'off'}`)
  console.log('')
  console.log(`recovered          ${report.recovered}/${report.processed} (${((100 * report.recovered) / report.processed).toFixed(1)}%)`)
  console.log(`money recovered    ${rupees(report.recoveredPaise)} of ${rupees(report.totalPaise)}`)
  console.log(`charge attempts    ${report.chargeAttempts} (${report.wastedChargeAttempts} on unrecoverable)`)
  console.log(`contacts sent      ${report.contacts}`)
  console.log(`escalated          ${report.escalated}`)
  console.log(`vetoed             ${report.vetoed}`)
  console.log('')
  console.log(`classification     ${report.correct}/${report.processed} (${((100 * report.correct) / report.processed).toFixed(1)}%)`)
  console.log(`llm hit rate       ${report.llmClassified}/${report.processed} (${((100 * report.llmClassified) / report.processed).toFixed(1)}%)`)
  console.log(`  cache hits       ${stats.cacheHits}`)
  console.log(`  API calls        ${stats.apiCalls}`)
  console.log(`  parse failures   ${stats.parseFailures}`)
  console.log('')
  console.log('by true cause:')
  for (const [cause, v] of Object.entries(report.byCause).sort()) {
    const pct = v.total === 0 ? 0 : (100 * v.recovered) / v.total
    console.log(`  ${cause.padEnd(28)} ${String(v.recovered).padStart(4)}/${String(v.total).padEnd(5)} ${pct.toFixed(0)}%`)
  }
  console.log('')
  console.log(`load ${((loadedAt - started) / 1000).toFixed(1)}s, total ${(totalMs / 1000).toFixed(1)}s, ${perRecord.toFixed(1)}ms per record`)
} finally {
  await prisma.$disconnect()
}
