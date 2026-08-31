import { prisma } from '@revenue/db'
import { PERMANENT_FAILURE_CAUSES, PLAYBOOKS } from '@revenue/core'
import type { ActionStatus, ActionType, AuditEvent, RootCause } from '@revenue/core'

export interface TimelineAction {
  id: string
  type: ActionType
  status: ActionStatus
  scheduledFor: Date | null
  executedAt: Date | null
  idempotencyKey: string
  vetoedBy: string | null
  vetoReason: string | null
  payload: unknown
  outcome: unknown
  createdAt: Date
}

export interface TimelineLog {
  id: string
  event: AuditEvent
  actionId: string | null
  ruleFired: string | null
  reasoning: string | null
  occurredAt: Date
  wallClockAt: Date
  inputSnapshot: unknown
}

export interface PlaybookView {
  rootCause: RootCause
  terminal: string
  maxRetries: number
  maxContacts: number
  cooldownMs: number
  steps: { action: string; detail: string }[]
}

export interface NoChargeNote {
  kind: 'permanent_failure' | 'customer_present' | 'unresolved_cause'
  guardrail: 'PERMANENT_FAILURE_BLOCK' | null
  headline: string
  detail: string
}

export function noChargeNoteFor(cause: RootCause): NoChargeNote | null {
  const pb = PLAYBOOKS[cause]
  if (pb.maxRetries > 0) return null

  if (PERMANENT_FAILURE_CAUSES.includes(cause)) {
    return {
      kind: 'permanent_failure',
      guardrail: 'PERMANENT_FAILURE_BLOCK',
      headline: `No charge was proposed for ${cause}.`,
      detail:
        'The playbook for this cause contains no retry step, so the chain goes straight to its ' +
        'terminal action. PERMANENT_FAILURE_BLOCK would veto a charge retry on this cause if one ' +
        'were ever proposed, but it does not appear below because there was nothing to veto. It ' +
        'is a backstop against a future playbook change, not a step that runs here.',
    }
  }

  if (cause === 'UNKNOWN') {
    return {
      kind: 'unresolved_cause',
      guardrail: null,
      headline: 'No charge was proposed, because the root cause was never determined.',
      detail:
        'The classifier could not resolve this failure and the model was either unavailable or ' +
        'below the confidence floor, so the policy engine escalates without acting rather than ' +
        'running a playbook on a guess. No guardrail was involved.',
    }
  }

  return {
    kind: 'customer_present',
    guardrail: null,
    headline: `No charge was proposed for ${cause}.`,
    detail:
      'This cause needs the customer present to complete the payment, so a silent retry cannot ' +
      'succeed and the playbook does not attempt one. No guardrail was involved: the policy ' +
      'engine never proposed a charge to block.',
  }
}

export interface PaymentTimeline {
  id: string
  razorpayPaymentId: string
  razorpayOrderId: string | null
  amountPaise: number
  method: string
  status: string
  failedAt: Date
  attemptNumber: number
  error: {
    code: string | null
    description: string | null
    source: string | null
    step: string | null
    reason: string | null
  }
  customer: { externalId: string; timezone: string; optedOut: boolean }
  diagnosis: {
    rootCause: RootCause
    confidence: number
    classifier: string
    evidence: string[]
    llmModel: string | null
    llmRawResponse: string | null
    createdAt: Date
  } | null
  playbook: PlaybookView | null
  noChargeNote: NoChargeNote | null
  actions: TimelineAction[]
  logs: TimelineLog[]
}

function describeStep(step: {
  action: string
  timing?: unknown
  delayMs?: number
  copyHint?: string
}): string {
  if (step.action === 'retry_charge') {
    const t = step.timing as
      | { kind: 'fixed'; delayMs: number }
      | { kind: 'salary_window'; withinDays: number; fallbackDelayMs: number }
      | { kind: 'next_local_midnight'; graceMs: number }
    if (t.kind === 'fixed') return `retry at +${Math.round(t.delayMs / 60000)}m`
    if (t.kind === 'next_local_midnight')
      return `retry at next local midnight +${Math.round(t.graceMs / 60000)}m`
    return `retry at the next salary window within ${t.withinDays}d, else +${Math.round(t.fallbackDelayMs / 3600000)}h`
  }
  if (step.action === 'issue_payment_link')
    return `issue a payment link at +${Math.round((step.delayMs ?? 0) / 60000)}m`
  return `nudge at +${Math.round((step.delayMs ?? 0) / 60000)}m — ${step.copyHint ?? ''}`
}

function playbookFor(cause: RootCause): PlaybookView {
  const pb = PLAYBOOKS[cause]
  return {
    rootCause: pb.rootCause,
    terminal: pb.terminal,
    maxRetries: pb.maxRetries,
    maxContacts: pb.maxContacts,
    cooldownMs: pb.cooldownMs,
    steps: pb.steps.map((s) => ({
      action: s.action,
      detail: describeStep(s as never),
    })),
  }
}

export async function loadTimeline(id: string): Promise<PaymentTimeline | null> {
  const row = await prisma.paymentAttempt.findUnique({
    where: { id },
    include: {
      customer: { select: { externalId: true, timezone: true, optedOut: true } },
      diagnosis: true,
      actions: { orderBy: { createdAt: 'asc' } },
      auditLogs: { orderBy: { occurredAt: 'asc' } },
    },
  })

  if (row === null) return null

  return {
    id: row.id,
    razorpayPaymentId: row.razorpayPaymentId,
    razorpayOrderId: row.razorpayOrderId,
    amountPaise: row.amountPaise,
    method: row.method,
    status: row.status,
    failedAt: row.failedAt,
    attemptNumber: row.attemptNumber,
    error: {
      code: row.errorCode,
      description: row.errorDescription,
      source: row.errorSource,
      step: row.errorStep,
      reason: row.errorReason,
    },
    customer: row.customer,
    diagnosis:
      row.diagnosis === null
        ? null
        : {
            rootCause: row.diagnosis.rootCause,
            confidence: row.diagnosis.confidence,
            classifier: row.diagnosis.classifier,
            evidence: row.diagnosis.evidence,
            llmModel: row.diagnosis.llmModel,
            llmRawResponse: row.diagnosis.llmRawResponse,
            createdAt: row.diagnosis.createdAt,
          },
    playbook: row.diagnosis === null ? null : playbookFor(row.diagnosis.rootCause),
    noChargeNote:
      row.diagnosis === null ? null : noChargeNoteFor(row.diagnosis.rootCause),
    actions: row.actions,
    logs: row.auditLogs,
  }
}
