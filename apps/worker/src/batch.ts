import { prisma } from '@revenue/db'
import { runBatch } from './orchestrator/batch.js'

const arg = (name: string, fallback: number): number => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (found === undefined) return fallback
  const value = Number(found.slice(name.length + 3))
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`)
  return value
}

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const options = {
  split: 'train' as const,
  limit: arg('limit', 200),
  concurrency: arg('concurrency', 4),
  maxSteps: arg('max-steps', 6),
  warpFactor: arg('warp-factor', 3600),
  reset: process.argv.includes('--reset'),
  llm: !process.argv.includes('--no-llm'),
}

console.log(
  `headless batch: train split, limit ${options.limit}, concurrency ${options.concurrency}, llm=${options.llm ? (process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash') : 'off'}`,
)
const started = Date.now()

try {
  const report = await runBatch(options)
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  console.log('')
  console.log(`processed        ${report.processed}`)
  console.log(`recovered        ${report.recovered}/${report.processed} (${((100 * report.recovered) / report.processed).toFixed(1)}%)`)
  console.log(`money recovered  ${rupees(report.recoveredPaise)} of ${rupees(report.totalPaise)}`)
  console.log(`charge attempts  ${report.chargeAttempts}`)
  console.log(`contacts sent    ${report.contacts}`)
  console.log(`escalated        ${report.escalated}`)
  console.log(`vetoed           ${report.vetoed}`)
  console.log(`errored          ${report.failed.length}`)

  for (const f of report.failed) {
    console.log(`  ${f.paymentId}  ${f.error}`)
  }
  if (report.llmModel !== null) {
    console.log('')
    console.log(`llm model        ${report.llmModel}`)
    console.log(`  API calls      ${report.llmCalls}`)
    console.log(`  cache hits     ${report.llmCacheHits}`)
    console.log(`  parse failures ${report.llmParseFailures}`)
  }
  console.log('')
  console.log('by true cause:')
  for (const [cause, v] of Object.entries(report.byCause).sort()) {
    const pct = v.total === 0 ? 0 : (100 * v.recovered) / v.total
    console.log(`  ${cause.padEnd(28)} ${String(v.recovered).padStart(4)}/${String(v.total).padEnd(4)} ${pct.toFixed(0)}%`)
  }
  console.log('')
  console.log(`took ${seconds}s`)
} finally {
  await prisma.$disconnect()
}
