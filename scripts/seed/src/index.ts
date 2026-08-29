import { prisma } from '@revenue/db'
import { generateDataset } from './generate.js'
import { load } from './load.js'
import { DATASET_VERSION } from './spec.js'

const seedArg = process.argv.find((a) => a.startsWith('--seed='))
const seed = seedArg === undefined ? 20260829 : Number(seedArg.slice('--seed='.length))

if (!Number.isInteger(seed)) {
  throw new Error(`--seed must be an integer, got ${seed}`)
}

const dryRun = process.argv.includes('--dry-run')

const dataset = generateDataset({ seed })

const holdout = dataset.payments.filter((p) => p.evalSplit === 'holdout').length
const masked = dataset.payments.filter((p) => p.masked).length

console.log(`dataset ${DATASET_VERSION}, seed ${seed}`)
console.log(`  customers ${dataset.customers.length}`)
console.log(`  payments  ${dataset.payments.length} (${dataset.payments.length - holdout} train, ${holdout} holdout)`)
console.log(`  masked    ${masked}`)

if (dryRun) {
  console.log('dry run, nothing written')
  process.exit(0)
}

try {
  const result = await load(dataset, DATASET_VERSION)
  console.log(`loaded ${result.customers} customers and ${result.payments} payments`)
} finally {
  await prisma.$disconnect()
}
