const RUPEE_GROUPS = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const RUPEE_PAISE = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  return `${sign}${RUPEE_GROUPS.format(Math.round(Math.abs(paise) / 100))}`
}

export function rupeesExact(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  return `${sign}${RUPEE_PAISE.format(Math.abs(paise) / 100)}`
}

export function money(paise: number): string {
  return `${paise < 0 ? '-' : ''}₹${RUPEE_GROUPS.format(Math.round(Math.abs(paise) / 100))}`
}

export function rate(n: number, d: number): string {
  if (d === 0) return 'n/a'
  return `${((100 * n) / d).toFixed(1)}%`
}

const UNITS: readonly [number, string][] = [
  [24 * 60 * 60 * 1000, 'd'],
  [60 * 60 * 1000, 'h'],
  [60 * 1000, 'm'],
]

export function offsetFrom(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime()
  const sign = ms < 0 ? '-' : '+'
  const abs = Math.abs(ms)

  for (const [size, suffix] of UNITS) {
    if (abs >= size) {
      const whole = Math.floor(abs / size)
      const remainder = Math.floor((abs % size) / (size / 60))
      if (suffix === 'm' || remainder === 0) return `${sign}${whole}${suffix}`
      return `${sign}${whole}${suffix}${String(remainder).padStart(2, '0')}`
    }
  }
  return `${sign}${Math.round(abs / 1000)}s`
}

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
})

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: 'Asia/Kolkata',
})

export function clock(at: Date): string {
  return CLOCK.format(at)
}

export function dayMonth(at: Date): string {
  return DATE.format(at)
}

export function stamp(at: Date): string {
  return `${DATE.format(at)} ${CLOCK.format(at)}`
}

export function methodLabel(method: string): string {
  return method === 'upi' ? 'UPI' : 'CRD'
}

export function causeShort(cause: string): string {
  return cause.replace(/_/g, ' ').toLowerCase()
}
