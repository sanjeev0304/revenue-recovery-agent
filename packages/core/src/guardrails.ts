import type {
  AttemptHistory,
  CustomerFacts,
  GuardrailVerdict,
  PaymentFacts,
  ProposedAction,
  RootCause,
} from './types.js'
import {
  CONTACT_CAP_PER_CUSTOMER_7D,
  CONTACT_CAP_PER_PAYMENT,
  DEFAULT_AMOUNT_CEILING_PAISE,
  GLOBAL_MAX_CHARGE_ATTEMPTS,
  QUIET_HOURS_END,
  QUIET_HOURS_START,
  type Playbook,
} from './playbooks.js'
import { PERMANENT_FAILURE_CAUSES } from './taxonomy.js'
import { localHour } from './time.js'

export const GUARDRAIL_NAMES = [
  'PERMANENT_FAILURE_BLOCK',
  'GLOBAL_ATTEMPT_CAP',
  'PLAYBOOK_ATTEMPT_CAP',
  'COOLDOWN',
  'QUIET_HOURS',
  'CONTACT_CAP',
  'OPT_OUT',
  'IDEMPOTENCY',
  'AMOUNT_CEILING',
] as const

export type GuardrailName = (typeof GUARDRAIL_NAMES)[number]

export interface GuardrailContext {
  payment: PaymentFacts
  customer: CustomerFacts
  history: AttemptHistory
  rootCause: RootCause
  playbook: Playbook
  action: ProposedAction
  now: Date
  amountCeilingPaise?: number
}

type Guardrail = (ctx: GuardrailContext) => string | null

const isCharge = (ctx: GuardrailContext) => ctx.action.type === 'retry_charge'
const isContact = (ctx: GuardrailContext) => ctx.action.type === 'send_nudge'

const permanentFailureBlock: Guardrail = (ctx) => {
  if (!isCharge(ctx)) return null
  if (!PERMANENT_FAILURE_CAUSES.includes(ctx.rootCause)) return null
  return `${ctx.rootCause} can never be recovered by retrying the charge`
}

const globalAttemptCap: Guardrail = (ctx) => {
  if (!isCharge(ctx)) return null
  if (ctx.history.chargeAttempts < GLOBAL_MAX_CHARGE_ATTEMPTS) return null
  return `payment already has ${ctx.history.chargeAttempts} charge attempts, global cap is ${GLOBAL_MAX_CHARGE_ATTEMPTS}`
}

const playbookAttemptCap: Guardrail = (ctx) => {
  if (isCharge(ctx)) {
    if (ctx.history.chargeAttempts < ctx.playbook.maxRetries) return null
    return `${ctx.rootCause} playbook allows ${ctx.playbook.maxRetries} retries, ${ctx.history.chargeAttempts} already made`
  }
  if (isContact(ctx)) {
    if (ctx.history.contactsForPayment < ctx.playbook.maxContacts) return null
    return `${ctx.rootCause} playbook allows ${ctx.playbook.maxContacts} contacts, ${ctx.history.contactsForPayment} already sent`
  }
  return null
}

const cooldown: Guardrail = (ctx) => {
  if (!isCharge(ctx)) return null
  const last = ctx.history.lastChargeAttemptAt
  if (last === null) return null

  const target = ctx.action.scheduledFor ?? ctx.now
  const elapsed = target.getTime() - last.getTime()
  if (elapsed >= ctx.playbook.cooldownMs) return null

  return `only ${Math.round(elapsed / 60000)}m since the last charge attempt, ${ctx.rootCause} requires ${Math.round(
    ctx.playbook.cooldownMs / 60000,
  )}m`
}

const quietHours: Guardrail = (ctx) => {
  if (!isContact(ctx)) return null

  const at = ctx.action.scheduledFor ?? ctx.now
  const hour = localHour(at, ctx.customer.timezone)
  if (hour < QUIET_HOURS_START && hour >= QUIET_HOURS_END) return null

  return `${String(hour).padStart(2, '0')}:00 ${ctx.customer.timezone} falls in quiet hours ${QUIET_HOURS_START}:00-0${QUIET_HOURS_END}:00`
}

const contactCap: Guardrail = (ctx) => {
  if (!isContact(ctx)) return null

  if (ctx.history.contactsForPayment >= CONTACT_CAP_PER_PAYMENT) {
    return `payment already has ${ctx.history.contactsForPayment} contacts, cap is ${CONTACT_CAP_PER_PAYMENT}`
  }
  if (ctx.history.contactsForCustomerLast7d >= CONTACT_CAP_PER_CUSTOMER_7D) {
    return `customer already contacted ${ctx.history.contactsForCustomerLast7d} times in 7 days, cap is ${CONTACT_CAP_PER_CUSTOMER_7D}`
  }
  return null
}

const optOut: Guardrail = (ctx) => {
  if (!isContact(ctx)) return null
  if (!ctx.customer.optedOut) return null
  return 'customer has opted out of contact'
}

const idempotency: Guardrail = (ctx) => {
  if (!ctx.history.usedIdempotencyKeys.has(ctx.action.idempotencyKey)) return null
  return `idempotency key ${ctx.action.idempotencyKey} has already been used`
}

const amountCeiling: Guardrail = (ctx) => {
  if (!isCharge(ctx)) return null
  const ceiling = ctx.amountCeilingPaise ?? DEFAULT_AMOUNT_CEILING_PAISE
  if (ctx.payment.amountPaise <= ceiling) return null
  return `amount ${ctx.payment.amountPaise} paise exceeds the automatic retry ceiling of ${ceiling} paise`
}

const GUARDRAILS: ReadonlyArray<readonly [GuardrailName, Guardrail]> = [
  ['PERMANENT_FAILURE_BLOCK', permanentFailureBlock],
  ['GLOBAL_ATTEMPT_CAP', globalAttemptCap],
  ['PLAYBOOK_ATTEMPT_CAP', playbookAttemptCap],
  ['COOLDOWN', cooldown],
  ['QUIET_HOURS', quietHours],
  ['CONTACT_CAP', contactCap],
  ['OPT_OUT', optOut],
  ['IDEMPOTENCY', idempotency],
  ['AMOUNT_CEILING', amountCeiling],
]

export function evaluateGuardrails(ctx: GuardrailContext): GuardrailVerdict {
  for (const [name, rule] of GUARDRAILS) {
    const reason = rule(ctx)
    if (reason !== null) {
      return { allowed: false, vetoedBy: name, reason }
    }
  }
  return { allowed: true }
}
