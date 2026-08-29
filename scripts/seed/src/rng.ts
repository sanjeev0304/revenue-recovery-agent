export interface Rng {
  next(): number
  int(minInclusive: number, maxExclusive: number): number
  uniform(min: number, max: number): number
  bernoulli(p: number): boolean
  normal(): number
  lognormal(median: number, sigma: number, lo: number, hi: number): number
  pick<T>(items: readonly T[]): T
  weighted<T>(items: readonly T[], weights: readonly number[]): T
  shuffle<T>(items: readonly T[]): T[]
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0

  const next = (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  let spare: number | null = null

  const normal = (): number => {
    if (spare !== null) {
      const value = spare
      spare = null
      return value
    }
    let u = 0
    let v = 0
    let s = 0
    do {
      u = next() * 2 - 1
      v = next() * 2 - 1
      s = u * u + v * v
    } while (s === 0 || s >= 1)
    const factor = Math.sqrt((-2 * Math.log(s)) / s)
    spare = v * factor
    return u * factor
  }

  const rng: Rng = {
    next,
    normal,
    int: (minInclusive, maxExclusive) =>
      minInclusive + Math.floor(next() * (maxExclusive - minInclusive)),
    uniform: (min, max) => min + next() * (max - min),
    bernoulli: (p) => next() < p,
    lognormal: (median, sigma, lo, hi) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const value = median * Math.exp(sigma * normal())
        if (value >= lo && value <= hi) return value
      }
      return Math.min(Math.max(median, lo), hi)
    },
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty list')
      return items[Math.floor(next() * items.length)]!
    },
    weighted: (items, weights) => {
      if (items.length !== weights.length) throw new Error('items and weights length mismatch')
      let total = 0
      for (const w of weights) {
        if (w < 0) throw new Error('negative weight')
        total += w
      }
      if (total <= 0) throw new Error('weights sum to zero')
      let roll = next() * total
      for (let i = 0; i < items.length; i++) {
        roll -= weights[i]!
        if (roll <= 0) return items[i]!
      }
      return items[items.length - 1]!
    },
    shuffle: (items) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a0 = out[i]!
        const b0 = out[j]!
        out[i] = b0
        out[j] = a0
      }
      return out
    },
  }

  return rng
}

export function largestRemainder(total: number, shares: readonly number[]): number[] {
  const raw = shares.map((s) => s * total)
  const floors = raw.map((r) => Math.floor(r))
  let remaining = total - floors.reduce((a, b) => a + b, 0)

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((x, y) => y.frac - x.frac || x.i - y.i)

  const out = [...floors]
  for (const { i } of order) {
    if (remaining <= 0) break
    out[i] = out[i]! + 1
    remaining--
  }
  return out
}
