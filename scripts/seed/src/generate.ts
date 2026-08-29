import {
  reasonsForCause,
  type EvalSplit,
  type PaymentMethod,
  type RootCause,
} from '@revenue/core'
import { createRng, largestRemainder, type Rng } from './rng.js'
import { deriveRecoverability, type Recoverability } from './recoverability.js'
import {
  AMOUNT_MAX_PAISE,
  AMOUNT_MIN_PAISE,
  AMOUNT_MULTIPLIER,
  AMOUNT_SIGMA,
  BASE_AMOUNT_MEDIAN_PAISE,
  BASE_DAY_LIFT,
  BASE_DAY_LIFT_DAYS,
  CAUSE_SHARES,
  CUSTOMER_POOL,
  CUSTOMER_TIMEZONE,
  DATASET_VERSION,
  DAY_OF_MONTH_BUCKETS,
  HOLDOUT_RECORDS,
  HOUR_BASE_WEIGHTS,
  HOUR_SKEW,
  INCIDENTS,
  IST_OFFSET_MS,
  MASK_RATE,
  OPAQUE_REASONS,
  OPAQUE_SOURCES,
  OPAQUE_STEPS,
  OPT_OUT_RATE,
  PRIOR_ATTEMPTS_PMF,
  P_UPI,
  REASON_DESCRIPTION,
  REASON_SOURCE_STEP,
  SPAN_DAYS,
  SPAN_END_UTC,
  TLE_DAILY_HOUR_SKEW,
  TLE_PER_TXN_CLUSTERS,
  TLE_PER_TXN_PRIOR_PMF,
  TLE_PER_TXN_SHARE,
  TOTAL_RECORDS,
  type Subtype,
} from './spec.js'

const DAY_MS = 24 * 60 * 60 * 1000

export interface GeneratedCustomer {
  externalId: string
  timezone: string
  optedOut: boolean
}

export interface GeneratedPayment {
  razorpayPaymentId: string
  razorpayOrderId: string
  customerExternalId: string
  amountPaise: number
  method: PaymentMethod
  failedAt: Date
  errorCode: string
  errorDescription: string
  errorSource: string
  errorStep: string
  errorReason: string
  attemptNumber: number
  trueCause: RootCause
  subtype: Subtype | null
  masked: boolean
  incidentId: string | null
  recoverableUnder: Recoverability
  evalSplit: EvalSplit
  datasetVersion: string
}

export interface Dataset {
  customers: GeneratedCustomer[]
  payments: GeneratedPayment[]
}

export interface GenerateConfig {
  seed: number
  total?: number
  holdout?: number
}

function skewedHourWeights(cause: RootCause, subtype: Subtype | null): number[] {
  const weights = [...HOUR_BASE_WEIGHTS]
  const skew =
    cause === 'TRANSACTION_LIMIT_EXCEEDED' && subtype === 'daily_cap'
      ? TLE_DAILY_HOUR_SKEW
      : HOUR_SKEW[cause]

  if (skew === undefined) return weights
  for (const hour of skew.hours) {
    weights[hour] = weights[hour]! * skew.k
  }
  return weights
}

function dayWeight(cause: RootCause, dayOfMonth: number): number {
  if (cause === 'INSUFFICIENT_FUNDS') {
    for (const [lo, hi, multiplier] of DAY_OF_MONTH_BUCKETS) {
      if (dayOfMonth >= lo && dayOfMonth <= hi) return multiplier
    }
    return 1
  }
  return (BASE_DAY_LIFT_DAYS as readonly number[]).includes(dayOfMonth) ? BASE_DAY_LIFT : 1
}

function pickFailedAt(cause: RootCause, subtype: Subtype | null, rng: Rng): Date {
  const spanEnd = new Date(SPAN_END_UTC).getTime()
  const spanStart = spanEnd - SPAN_DAYS * DAY_MS

  const localMidnights: number[] = []
  const dayWeights: number[] = []
  for (let d = 0; d < SPAN_DAYS; d++) {
    const localEpoch = spanStart + d * DAY_MS + IST_OFFSET_MS
    const localMidnight = Math.floor(localEpoch / DAY_MS) * DAY_MS
    localMidnights.push(localMidnight)
    dayWeights.push(dayWeight(cause, new Date(localMidnight).getUTCDate()))
  }

  const localMidnight = rng.weighted(localMidnights, dayWeights)
  const hourWeights = skewedHourWeights(cause, subtype)
  const hour = rng.weighted(
    hourWeights.map((_, i) => i),
    hourWeights,
  )

  const withinDay = hour * 60 * 60 * 1000 + rng.int(0, 60) * 60_000 + rng.int(0, 60) * 1000

  return new Date(localMidnight + withinDay - IST_OFFSET_MS)
}

function pickMethod(cause: RootCause, rng: Rng): PaymentMethod {
  return rng.bernoulli(P_UPI[cause]) ? 'upi' : 'card'
}

function pickAmount(cause: RootCause, subtype: Subtype | null, rng: Rng): number {
  if (cause === 'TRANSACTION_LIMIT_EXCEEDED' && subtype === 'per_txn_cap') {
    const cluster = rng.weighted(
      TLE_PER_TXN_CLUSTERS.map((c) => c),
      TLE_PER_TXN_CLUSTERS.map((c) => c[0]),
    )
    return Math.round(rng.uniform(cluster[1], cluster[2]))
  }
  const median = BASE_AMOUNT_MEDIAN_PAISE * AMOUNT_MULTIPLIER[cause]
  return Math.round(
    rng.lognormal(median, AMOUNT_SIGMA, AMOUNT_MIN_PAISE, AMOUNT_MAX_PAISE),
  )
}

function pickPriorAttempts(cause: RootCause, subtype: Subtype | null, rng: Rng): number {
  const pmf =
    cause === 'TRANSACTION_LIMIT_EXCEEDED' && subtype === 'per_txn_cap'
      ? TLE_PER_TXN_PRIOR_PMF
      : PRIOR_ATTEMPTS_PMF[cause]
  return rng.weighted([0, 1, 2, 3], pmf)
}

function pickTrueReason(cause: RootCause, method: PaymentMethod, rng: Rng): string {
  const candidates = reasonsForCause(cause, method)
  if (candidates.length === 0) {
    throw new Error(`no reason available for ${cause} on ${method}`)
  }
  return rng.pick(candidates).reason
}

function opaqueSourceStep(rng: Rng): { source: string; step: string } {
  return {
    source: rng.weighted(
      OPAQUE_SOURCES.map((s) => s[0]),
      OPAQUE_SOURCES.map((s) => s[1]),
    ),
    step: rng.weighted(
      OPAQUE_STEPS.map((s) => s[0]),
      OPAQUE_STEPS.map((s) => s[1]),
    ),
  }
}

function trueSourceStep(reason: string, rng: Rng): { source: string; step: string } {
  const options = REASON_SOURCE_STEP[reason] ?? []
  if (options.length === 0) return opaqueSourceStep(rng)
  const chosen = rng.weighted(
    options.map((o) => o),
    options.map((o) => o[2]),
  )
  return { source: chosen[0], step: chosen[1] }
}

function errorCodeFor(source: string): string {
  return source === 'gateway' || source === 'razorpay' ? 'GATEWAY_ERROR' : 'BAD_REQUEST_ERROR'
}

interface Draft {
  cause: RootCause
  subtype: Subtype | null
  incidentId: string | null
  failedAt: Date | null
}

function buildDrafts(rng: Rng, total: number): Draft[] {
  const causes = CAUSE_SHARES.map((c) => c[0])
  const counts = largestRemainder(
    total,
    CAUSE_SHARES.map((c) => c[1]),
  )

  const drafts: Draft[] = []

  for (let ci = 0; ci < causes.length; ci++) {
    const cause = causes[ci]!
    const count = counts[ci]!
    const incidentSpec = INCIDENTS[cause]

    if (incidentSpec === undefined) {
      for (let i = 0; i < count; i++) {
        const subtype: Subtype | null =
          cause === 'TRANSACTION_LIMIT_EXCEEDED'
            ? rng.bernoulli(TLE_PER_TXN_SHARE)
              ? 'per_txn_cap'
              : 'daily_cap'
            : null
        drafts.push({ cause, subtype, incidentId: null, failedAt: null })
      }
      continue
    }

    let remaining = count
    let incidentIndex = 0
    while (remaining > 0) {
      const target = rng.int(incidentSpec.sizeMin, incidentSpec.sizeMax + 1)
      const size = Math.min(target, remaining)
      const incidentId = `${cause.toLowerCase()}_incident_${incidentIndex}`
      const anchor = pickFailedAt(cause, null, rng)
      const spread = rng.uniform(incidentSpec.spreadMinMs, incidentSpec.spreadMaxMs)

      for (let i = 0; i < size; i++) {
        drafts.push({
          cause,
          subtype: null,
          incidentId,
          failedAt: new Date(anchor.getTime() + rng.uniform(0, spread)),
        })
      }
      remaining -= size
      incidentIndex++
    }
  }

  return drafts
}

function assignSplits(drafts: readonly Draft[], holdout: number, rng: Rng): EvalSplit[] {
  const splits: EvalSplit[] = new Array(drafts.length).fill('train')
  const byCause = new Map<RootCause, number[]>()

  drafts.forEach((d, i) => {
    const list = byCause.get(d.cause) ?? []
    list.push(i)
    byCause.set(d.cause, list)
  })

  const holdoutFraction = holdout / drafts.length
  let assigned = 0

  for (const [, indices] of [...byCause.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const target = Math.round(indices.length * holdoutFraction)

    const incidents = new Map<string, number[]>()
    const singles: number[] = []
    for (const i of indices) {
      const id = drafts[i]!.incidentId
      if (id === null) {
        singles.push(i)
      } else {
        const group = incidents.get(id) ?? []
        group.push(i)
        incidents.set(id, group)
      }
    }

    let taken = 0
    for (const group of rng.shuffle([...incidents.values()])) {
      if (taken + group.length > target) continue
      for (const i of group) splits[i] = 'holdout'
      taken += group.length
    }
    for (const i of rng.shuffle(singles)) {
      if (taken >= target) break
      splits[i] = 'holdout'
      taken++
    }
    assigned += taken
  }

  if (assigned !== holdout) {
    const trainIndices = rng.shuffle(
      drafts.map((_, i) => i).filter((i) => splits[i] === 'train'),
    )
    const holdoutIndices = rng.shuffle(
      drafts.map((_, i) => i).filter((i) => splits[i] === 'holdout'),
    )
    let delta = holdout - assigned
    while (delta > 0 && trainIndices.length > 0) {
      const i = trainIndices.pop()!
      if (drafts[i]!.incidentId !== null) continue
      splits[i] = 'holdout'
      delta--
    }
    while (delta < 0 && holdoutIndices.length > 0) {
      const i = holdoutIndices.pop()!
      if (drafts[i]!.incidentId !== null) continue
      splits[i] = 'train'
      delta++
    }
  }

  return splits
}

export function generateDataset(config: GenerateConfig): Dataset {
  const total = config.total ?? TOTAL_RECORDS
  const holdout = config.holdout ?? HOLDOUT_RECORDS
  const rng = createRng(config.seed)

  const customers: GeneratedCustomer[] = []
  for (let i = 0; i < CUSTOMER_POOL; i++) {
    customers.push({
      externalId: `cust_${String(i).padStart(5, '0')}`,
      timezone: CUSTOMER_TIMEZONE,
      optedOut: rng.bernoulli(OPT_OUT_RATE),
    })
  }

  const drafts = rng.shuffle(buildDrafts(rng, total))
  const splits = assignSplits(drafts, holdout, rng)

  const payments: GeneratedPayment[] = drafts.map((draft, index) => {
    const { cause, subtype, incidentId } = draft
    const method = pickMethod(cause, rng)
    const failedAt = draft.failedAt ?? pickFailedAt(cause, subtype, rng)
    const amountPaise = pickAmount(cause, subtype, rng)
    const priorAttempts = pickPriorAttempts(cause, subtype, rng)

    const trueReason = pickTrueReason(cause, method, rng)
    const masked = rng.bernoulli(MASK_RATE[cause])

    const reason = masked ? rng.pick(OPAQUE_REASONS[method]) : trueReason
    const { source, step } = masked ? opaqueSourceStep(rng) : trueSourceStep(trueReason, rng)

    return {
      razorpayPaymentId: `pay_${DATASET_VERSION}_${String(index).padStart(5, '0')}`,
      razorpayOrderId: `order_${DATASET_VERSION}_${String(index).padStart(5, '0')}`,
      customerExternalId: rng.pick(customers).externalId,
      amountPaise,
      method,
      failedAt,
      errorCode: errorCodeFor(source),
      errorDescription: REASON_DESCRIPTION[reason] ?? 'The payment failed.',
      errorSource: source,
      errorStep: step,
      errorReason: reason,
      attemptNumber: priorAttempts + 1,
      trueCause: cause,
      subtype,
      masked,
      incidentId,
      recoverableUnder: deriveRecoverability(cause, subtype, failedAt, rng),
      evalSplit: splits[index]!,
      datasetVersion: DATASET_VERSION,
    }
  })

  return { customers, payments }
}
