export interface BurstCounts {
  windowMs: number
  failuresInWindow: number
  baselineForWindow: number
  sameMethodCount: number
  sameReasonCount: number
}

export interface RecentFailureWindow {
  windowMs: number
  failuresInWindow: number
  baselineForWindow: number
  ratio: number
  sameMethodShare: number
  sameReasonShare: number
}

export const BURST_WINDOW_MS = 20 * 60_000

function requireNonNegative(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number, got ${value}`)
  }
}

export function summariseBurst(counts: BurstCounts): RecentFailureWindow {
  requireNonNegative('windowMs', counts.windowMs)
  requireNonNegative('failuresInWindow', counts.failuresInWindow)
  requireNonNegative('baselineForWindow', counts.baselineForWindow)
  requireNonNegative('sameMethodCount', counts.sameMethodCount)
  requireNonNegative('sameReasonCount', counts.sameReasonCount)

  if (counts.sameMethodCount > counts.failuresInWindow) {
    throw new Error('sameMethodCount cannot exceed failuresInWindow')
  }
  if (counts.sameReasonCount > counts.failuresInWindow) {
    throw new Error('sameReasonCount cannot exceed failuresInWindow')
  }

  const denominator = Math.max(counts.failuresInWindow, 1)

  return {
    windowMs: counts.windowMs,
    failuresInWindow: counts.failuresInWindow,
    baselineForWindow: counts.baselineForWindow,
    ratio: counts.failuresInWindow / Math.max(counts.baselineForWindow, 1),
    sameMethodShare: counts.sameMethodCount / denominator,
    sameReasonShare: counts.sameReasonCount / denominator,
  }
}
