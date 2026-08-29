import type {
  AttemptHistory,
  CustomerFacts,
  Decision,
  Diagnosis,
  PaymentFacts,
  ProposedAction,
} from './types.js'
import {
  PLAYBOOKS,
  UNKNOWN_CONFIDENCE_FLOOR,
  halveCaps,
  type Playbook,
  type PlaybookStep,
  type RetryTiming,
} from './playbooks.js'
import { evaluateGuardrails } from './guardrails.js'
import { lookupReason } from './taxonomy.js'
import { DAY_MS, addMs, nextLocalMidnight, nextSalaryWindow } from './time.js'

export interface PolicyInput {
  payment: PaymentFacts
  customer: CustomerFacts
  diagnosis: Diagnosis
  history: AttemptHistory
  now: Date
  amountCeilingPaise?: number
}

export interface PolicyResolution {
  playbook: Playbook
  capsHalved: boolean
}

export function resolvePlaybook(payment: PaymentFacts, diagnosis: Diagnosis): PolicyResolution {
  const reason = payment.failure.reason
  const mapped = reason === null ? undefined : lookupReason(reason)
  const viaUnknown = mapped === undefined || !mapped.methods.includes(payment.method)

  const base = PLAYBOOKS[diagnosis.rootCause]

  if (viaUnknown && diagnosis.classifier === 'llm') {
    return { playbook: halveCaps(base), capsHalved: true }
  }
  return { playbook: base, capsHalved: false }
}

function scheduleRetry(
  timing: RetryTiming,
  base: Date,
  timezone: string,
): Date {
  switch (timing.kind) {
    case 'fixed':
      return addMs(base, timing.delayMs)
    case 'next_local_midnight':
      return addMs(nextLocalMidnight(base, timezone), timing.graceMs)
    case 'salary_window': {
      const window = nextSalaryWindow(base, timezone)
      const withinMs = timing.withinDays * DAY_MS
      if (window.getTime() - base.getTime() <= withinMs) return window
      return addMs(base, timing.fallbackDelayMs)
    }
  }
}

function buildAction(
  step: PlaybookStep,
  stepIndex: number,
  input: PolicyInput,
): ProposedAction {
  const base = input.history.lastActionAt ?? input.payment.failedAt
  const key = `${input.payment.paymentId}:${stepIndex}:${step.action}`

  switch (step.action) {
    case 'retry_charge':
      return {
        type: 'retry_charge',
        scheduledFor: scheduleRetry(step.timing, base, input.customer.timezone),
        idempotencyKey: key,
        payload: { amountPaise: input.payment.amountPaise, method: input.payment.method },
      }
    case 'issue_payment_link':
      return {
        type: 'issue_payment_link',
        scheduledFor: addMs(base, step.delayMs),
        idempotencyKey: key,
        payload: { amountPaise: input.payment.amountPaise },
      }
    case 'send_nudge':
      return {
        type: 'send_nudge',
        scheduledFor: addMs(base, step.delayMs),
        idempotencyKey: key,
        payload: { includeLink: step.includeLink, copyHint: step.copyHint },
      }
  }
}

function escalation(input: PolicyInput, stepIndex: number): ProposedAction {
  return {
    type: 'escalate',
    scheduledFor: null,
    idempotencyKey: `${input.payment.paymentId}:${stepIndex}:escalate`,
    payload: {
      rootCause: input.diagnosis.rootCause,
      reason: input.payment.failure.reason,
      confidence: input.diagnosis.confidence,
    },
  }
}

function decisionShell(input: PolicyInput, evidence: string[]): Omit<
  Decision,
  'proposedAction' | 'guardrailVerdict' | 'scheduledFor'
> {
  return {
    paymentId: input.payment.paymentId,
    rootCause: input.diagnosis.rootCause,
    confidence: input.diagnosis.confidence,
    classifier: input.diagnosis.classifier,
    razorpayReason: input.payment.failure.reason,
    razorpaySource: input.payment.failure.source,
    razorpayStep: input.payment.failure.step,
    evidence,
  }
}

export function decide(input: PolicyInput): Decision {
  const { playbook, capsHalved } = resolvePlaybook(input.payment, input.diagnosis)
  const evidence = [...input.diagnosis.evidence]

  if (capsHalved) {
    evidence.push(
      `reason was unmapped, following ${playbook.rootCause} with caps halved to ${playbook.maxRetries} retries and ${playbook.maxContacts} contacts`,
    )
  }

  const belowFloor =
    input.diagnosis.classifier === 'llm' && input.diagnosis.confidence < UNKNOWN_CONFIDENCE_FLOOR

  if (input.diagnosis.rootCause === 'UNKNOWN' || belowFloor) {
    if (belowFloor) {
      evidence.push(
        `confidence ${input.diagnosis.confidence} is below the ${UNKNOWN_CONFIDENCE_FLOOR} floor, escalating without acting`,
      )
    } else {
      evidence.push('root cause could not be determined, escalating without acting')
    }
    const action = escalation(input, input.history.completedSteps)
    return {
      ...decisionShell(input, evidence),
      proposedAction: action,
      guardrailVerdict: evaluateGuardrails({ ...guardCtx(input, playbook), action }),
      scheduledFor: null,
    }
  }

  const stepIndex = input.history.completedSteps
  const step = playbook.steps[stepIndex]

  if (step === undefined) {
    evidence.push(`playbook exhausted after ${stepIndex} steps, terminal is ${playbook.terminal}`)

    if (playbook.terminal === 'stop') {
      return {
        ...decisionShell(input, evidence),
        proposedAction: null,
        guardrailVerdict: { allowed: true },
        scheduledFor: null,
      }
    }

    const action = escalation(input, stepIndex)
    return {
      ...decisionShell(input, evidence),
      proposedAction: action,
      guardrailVerdict: evaluateGuardrails({ ...guardCtx(input, playbook), action }),
      scheduledFor: null,
    }
  }

  const action = buildAction(step, stepIndex, input)
  evidence.push(`playbook step ${stepIndex + 1}/${playbook.steps.length}: ${step.action}`)

  const verdict = evaluateGuardrails({ ...guardCtx(input, playbook), action })

  return {
    ...decisionShell(input, evidence),
    proposedAction: action,
    guardrailVerdict: verdict,
    scheduledFor: verdict.allowed ? action.scheduledFor : null,
  }
}

function guardCtx(input: PolicyInput, playbook: Playbook) {
  return {
    payment: input.payment,
    customer: input.customer,
    history: input.history,
    rootCause: input.diagnosis.rootCause,
    playbook,
    now: input.now,
    ...(input.amountCeilingPaise !== undefined
      ? { amountCeilingPaise: input.amountCeilingPaise }
      : {}),
  }
}
