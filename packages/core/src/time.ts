export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export function addMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms)
}

export interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function localParts(at: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })

  const parts: Record<string, string> = {}
  for (const part of fmt.formatToParts(at)) {
    parts[part.type] = part.value
  }

  const hour = Number(parts['hour'])

  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: hour === 24 ? 0 : hour,
    minute: Number(parts['minute']),
    weekday: WEEKDAY_INDEX[parts['weekday'] ?? 'Sun'] ?? 0,
  }
}

export function localHour(at: Date, timezone: string): number {
  return localParts(at, timezone).hour
}

function timezoneOffsetMs(at: Date, timezone: string): number {
  const p = localParts(at, timezone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  const rounded = Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS
  return asUtc - rounded
}

export function nextLocalMidnight(at: Date, timezone: string): Date {
  const offset = timezoneOffsetMs(at, timezone)
  const local = at.getTime() + offset
  const nextLocalDayStart = Math.floor(local / DAY_MS) * DAY_MS + DAY_MS
  return new Date(nextLocalDayStart - offset)
}

export function isLastWorkingDayOfMonth(year: number, month: number, day: number): boolean {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  for (let d = lastDay; d >= 1; d--) {
    const weekday = new Date(Date.UTC(year, month - 1, d)).getUTCDay()
    if (weekday !== 0 && weekday !== 6) {
      return d === day
    }
  }
  return false
}

export function nextSalaryWindow(from: Date, timezone: string): Date {
  const p = localParts(from, timezone)
  const offset = timezoneOffsetMs(from, timezone)

  for (let ahead = 1; ahead <= 40; ahead++) {
    const candidate = new Date(Date.UTC(p.year, p.month - 1, p.day + ahead, 10, 0))
    const c = {
      year: candidate.getUTCFullYear(),
      month: candidate.getUTCMonth() + 1,
      day: candidate.getUTCDate(),
    }
    if (c.day === 1 || isLastWorkingDayOfMonth(c.year, c.month, c.day)) {
      return new Date(candidate.getTime() - offset)
    }
  }

  return addMs(from, 30 * DAY_MS)
}

export function deferPastQuietHours(
  at: Date,
  timezone: string,
  quietStartHour: number,
  quietEndHour: number,
): Date {
  const hour = localHour(at, timezone)
  const inQuietHours = hour >= quietStartHour || hour < quietEndHour
  if (!inQuietHours) return at

  const nextMidnight = nextLocalMidnight(at, timezone)

  if (hour < quietEndHour) {
    return new Date(nextMidnight.getTime() - DAY_MS + quietEndHour * HOUR_MS)
  }
  return new Date(nextMidnight.getTime() + quietEndHour * HOUR_MS)
}
