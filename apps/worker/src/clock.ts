export type ClockKind = 'real' | 'warped'

export interface Clock {
  readonly kind: ClockKind
  now(): Date
  delayUntil(at: Date): number
  describe(): string
}

export type MillisSource = () => number

export class RealClock implements Clock {
  readonly kind = 'real' as const

  private readonly source: MillisSource

  constructor(source: MillisSource = Date.now) {
    this.source = source
  }

  now(): Date {
    return new Date(this.source())
  }

  delayUntil(at: Date): number {
    return Math.max(0, at.getTime() - this.source())
  }

  describe(): string {
    return 'real time'
  }
}

export class WarpedClock implements Clock {
  readonly kind = 'warped' as const

  private readonly origin: Date
  private readonly factor: number
  private readonly source: MillisSource
  private readonly realStart: number

  constructor(origin: Date, factor: number, source: MillisSource = Date.now) {
    if (Number.isNaN(origin.getTime())) {
      throw new Error('warp origin is not a valid date')
    }
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`warp factor must be a positive finite number, got ${factor}`)
    }
    this.origin = origin
    this.factor = factor
    this.source = source
    this.realStart = source()
  }

  now(): Date {
    const realElapsed = this.source() - this.realStart
    return new Date(this.origin.getTime() + realElapsed * this.factor)
  }

  delayUntil(at: Date): number {
    const simulatedGap = at.getTime() - this.now().getTime()
    return Math.max(0, Math.round(simulatedGap / this.factor))
  }

  describe(): string {
    return `warped x${this.factor} from ${this.origin.toISOString()}`
  }
}

export function createClock(config: {
  warpOrigin: Date | null
  warpFactor: number | null
  source?: MillisSource
}): Clock {
  if (config.warpOrigin === null && config.warpFactor === null) {
    return new RealClock(config.source)
  }
  if (config.warpOrigin === null || config.warpFactor === null) {
    throw new Error('WARP_ORIGIN and WARP_FACTOR must be set together or not at all')
  }
  return new WarpedClock(config.warpOrigin, config.warpFactor, config.source)
}
