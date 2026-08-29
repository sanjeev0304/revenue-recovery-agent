import type { RootCause } from './types.js'
import { DAY_MS, HOUR_MS, MINUTE_MS } from './time.js'

export type RetryTiming =
  | { kind: 'fixed'; delayMs: number }
  | { kind: 'salary_window'; withinDays: number; fallbackDelayMs: number }
  | { kind: 'next_local_midnight'; graceMs: number }

export type PlaybookStep =
  | { action: 'retry_charge'; timing: RetryTiming }
  | { action: 'issue_payment_link'; delayMs: number }
  | { action: 'send_nudge'; delayMs: number; includeLink: boolean; copyHint: string }

export type TerminalBehaviour = 'stop' | 'escalate' | 'rediagnose'

export interface Playbook {
  rootCause: RootCause
  steps: readonly PlaybookStep[]
  terminal: TerminalBehaviour
  maxRetries: number
  maxContacts: number
  cooldownMs: number
}

function retryCount(steps: readonly PlaybookStep[]): number {
  return steps.filter((s) => s.action === 'retry_charge').length
}

function contactCount(steps: readonly PlaybookStep[]): number {
  return steps.filter((s) => s.action === 'send_nudge').length
}

function playbook(
  rootCause: RootCause,
  steps: readonly PlaybookStep[],
  terminal: TerminalBehaviour,
  cooldownMs: number,
): Playbook {
  return {
    rootCause,
    steps,
    terminal,
    maxRetries: retryCount(steps),
    maxContacts: contactCount(steps),
    cooldownMs,
  }
}

export const PLAYBOOKS: Readonly<Record<RootCause, Playbook>> = {
  INSUFFICIENT_FUNDS: playbook(
    'INSUFFICIENT_FUNDS',
    [
      { action: 'retry_charge', timing: { kind: 'fixed', delayMs: 24 * HOUR_MS } },
      {
        action: 'retry_charge',
        timing: { kind: 'salary_window', withinDays: 5, fallbackDelayMs: 48 * HOUR_MS },
      },
      {
        action: 'send_nudge',
        delayMs: 24 * HOUR_MS,
        includeLink: true,
        copyHint: 'Offer a payment link. Do not imply the customer is short of money.',
      },
    ],
    'stop',
    24 * HOUR_MS,
  ),

  TRANSACTION_LIMIT_EXCEEDED: playbook(
    'TRANSACTION_LIMIT_EXCEEDED',
    [
      { action: 'retry_charge', timing: { kind: 'next_local_midnight', graceMs: HOUR_MS } },
      {
        action: 'send_nudge',
        delayMs: 12 * HOUR_MS,
        includeLink: true,
        copyHint: 'Suggest a different instrument or splitting the amount.',
      },
    ],
    'escalate',
    12 * HOUR_MS,
  ),

  AUTH_FAILED: playbook(
    'AUTH_FAILED',
    [
      { action: 'issue_payment_link', delayMs: 0 },
      {
        action: 'send_nudge',
        delayMs: 2 * HOUR_MS,
        includeLink: true,
        copyHint: 'Suggest UPI as an alternative to card plus OTP.',
      },
    ],
    'escalate',
    0,
  ),

  CUSTOMER_ABANDONED: playbook(
    'CUSTOMER_ABANDONED',
    [
      { action: 'issue_payment_link', delayMs: 0 },
      {
        action: 'send_nudge',
        delayMs: 2 * HOUR_MS,
        includeLink: true,
        copyHint: 'Light reminder. The customer chose to stop, so do not push hard.',
      },
      {
        action: 'send_nudge',
        delayMs: 22 * HOUR_MS,
        includeLink: true,
        copyHint: 'Final reminder. Make clear this is the last message.',
      },
    ],
    'escalate',
    0,
  ),

  ISSUER_DOWNTIME: playbook(
    'ISSUER_DOWNTIME',
    [
      { action: 'retry_charge', timing: { kind: 'fixed', delayMs: 30 * MINUTE_MS } },
      { action: 'retry_charge', timing: { kind: 'fixed', delayMs: 90 * MINUTE_MS } },
      { action: 'retry_charge', timing: { kind: 'fixed', delayMs: 4 * HOUR_MS } },
    ],
    'rediagnose',
    30 * MINUTE_MS,
  ),

  GATEWAY_DOWNTIME: playbook(
    'GATEWAY_DOWNTIME',
    [
      { action: 'retry_charge', timing: { kind: 'fixed', delayMs: 15 * MINUTE_MS } },
      { action: 'retry_charge', timing: { kind: 'fixed', delayMs: 45 * MINUTE_MS } },
      { action: 'retry_charge', timing: { kind: 'fixed', delayMs: 3 * HOUR_MS } },
    ],
    'stop',
    15 * MINUTE_MS,
  ),

  INSTRUMENT_INVALID: playbook(
    'INSTRUMENT_INVALID',
    [
      { action: 'issue_payment_link', delayMs: 0 },
      {
        action: 'send_nudge',
        delayMs: 5 * MINUTE_MS,
        includeLink: true,
        copyHint: 'Ask for an updated payment method. Never suggest retrying the same one.',
      },
    ],
    'escalate',
    0,
  ),

  RISK_DECLINE: playbook('RISK_DECLINE', [], 'escalate', 0),

  OPAQUE_BANK_DECLINE: playbook(
    'OPAQUE_BANK_DECLINE',
    [
      { action: 'retry_charge', timing: { kind: 'fixed', delayMs: 6 * HOUR_MS } },
      {
        action: 'send_nudge',
        delayMs: 6 * HOUR_MS,
        includeLink: true,
        copyHint: 'Suggest an alternate method. The bank gave no reason, so do not invent one.',
      },
    ],
    'escalate',
    6 * HOUR_MS,
  ),

  TECHNICAL_UNRESOLVED: playbook('TECHNICAL_UNRESOLVED', [], 'escalate', 0),

  UNKNOWN: playbook('UNKNOWN', [], 'escalate', 0),
}

export const UNKNOWN_CONFIDENCE_FLOOR = 0.6

export function halveCaps(pb: Playbook): Playbook {
  const allowedRetries = Math.floor(pb.maxRetries / 2)
  const allowedContacts = Math.floor(pb.maxContacts / 2)

  let retriesSeen = 0
  let contactsSeen = 0
  const steps: PlaybookStep[] = []

  for (const step of pb.steps) {
    if (step.action === 'retry_charge') {
      if (retriesSeen >= allowedRetries) continue
      retriesSeen++
    }
    if (step.action === 'send_nudge') {
      if (contactsSeen >= allowedContacts) continue
      contactsSeen++
    }
    steps.push(step)
  }

  return {
    ...pb,
    steps,
    maxRetries: allowedRetries,
    maxContacts: allowedContacts,
  }
}

export const GLOBAL_MAX_CHARGE_ATTEMPTS = 3
export const QUIET_HOURS_START = 21
export const QUIET_HOURS_END = 9
export const CONTACT_CAP_PER_PAYMENT = 2
export const CONTACT_CAP_PER_CUSTOMER_7D = 3
export const DEFAULT_AMOUNT_CEILING_PAISE = 50_000_000
export const CONTACT_WINDOW_MS = 7 * DAY_MS
