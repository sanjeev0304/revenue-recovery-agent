import { describe, expect, it } from 'vitest'
import type {
  ActionExecutor,
  Decision,
  ExecutionResult,
  ExecutorRegistry,
} from '@revenue/core'
import { executeDecision, type ExecutionStore } from './execute.js'

const OCCURRED = new Date('2026-07-15T06:30:00Z')

function decision(over: Partial<Decision> = {}): Decision {
  return {
    paymentId: 'pay_1',
    rootCause: 'INSUFFICIENT_FUNDS',
    confidence: 1,
    classifier: 'deterministic',
    razorpayReason: 'insufficient_funds',
    razorpaySource: 'bank',
    razorpayStep: 'payment_authorization',
    proposedAction: {
      type: 'retry_charge',
      scheduledFor: OCCURRED,
      idempotencyKey: 'pay_1:0:retry_charge',
      payload: { amountPaise: 250000 },
    },
    guardrailVerdict: { allowed: true },
    scheduledFor: OCCURRED,
    evidence: ['test'],
    ...over,
  }
}

class RecordingStore implements ExecutionStore {
  readonly calls: string[] = []
  readonly results: ExecutionResult[] = []

  async openAction(): Promise<{ actionId: string; auditId: string }> {
    this.calls.push('open')
    return { actionId: 'act_1', auditId: 'aud_1' }
  }

  async closeAction(input: { result: ExecutionResult }): Promise<void> {
    this.calls.push('close')
    this.results.push(input.result)
  }

  async recordVeto(): Promise<void> {
    this.calls.push('veto')
  }
}

function registry(executor: Partial<ActionExecutor> & { onExecute?: () => void }): ExecutorRegistry {
  const make = (type: string): ActionExecutor => ({
    type: type as ActionExecutor['type'],
    execute: async () => {
      executor.onExecute?.()
      return (
        (await executor.execute?.({} as never)) ?? {
          status: 'accepted',
          providerRef: 'ref_1',
          detail: {},
        }
      )
    },
  })
  return {
    retry_charge: make('retry_charge'),
    issue_payment_link: make('issue_payment_link'),
    send_nudge: make('send_nudge'),
    escalate: make('escalate'),
  }
}

const input = {
  paymentAttemptId: 'local_1',
  amountPaise: 250000,
  method: 'upi' as const,
  failedAt: new Date('2026-07-14T06:30:00Z'),
  occurredAt: OCCURRED,
}

describe('audit ordering', () => {
  it('opens the audit row before the executor runs and closes it after', async () => {
    const store = new RecordingStore()
    const order: string[] = []

    const executors = registry({
      onExecute: () => order.push('execute'),
    })

    const wrapped: ExecutionStore = {
      openAction: async () => {
        order.push('open')
        return store.openAction()
      },
      closeAction: async (arg) => {
        order.push('close')
        return store.closeAction(arg)
      },
      recordVeto: async () => {
        order.push('veto')
      },
    }

    await executeDecision({ store: wrapped, executors }, { ...input, decision: decision() })

    expect(order).toEqual(['open', 'execute', 'close'])
  })

  it('still closes the row when the executor throws', async () => {
    const store = new RecordingStore()
    const executors = registry({
      execute: async () => {
        throw new Error('provider exploded')
      },
    })

    const out = await executeDecision({ store, executors }, { ...input, decision: decision() })

    expect(store.calls).toEqual(['open', 'close'])
    expect(out).toMatchObject({ executed: true })
    expect(store.results[0]).toMatchObject({ status: 'rejected', code: 'executor_threw' })
  })

  it('records a rejection without losing the audit row', async () => {
    const store = new RecordingStore()
    const executors = registry({
      execute: async () => ({ status: 'rejected', code: 'http_400', message: 'bad' }),
    })

    await executeDecision({ store, executors }, { ...input, decision: decision() })
    expect(store.calls).toEqual(['open', 'close'])
    expect(store.results[0]).toMatchObject({ code: 'http_400' })
  })
})

describe('vetoed and empty decisions', () => {
  it('logs a veto and never opens an action or runs an executor', async () => {
    const store = new RecordingStore()
    let executed = false
    const executors = registry({ onExecute: () => (executed = true) })

    const out = await executeDecision(
      { store, executors },
      {
        ...input,
        decision: decision({
          guardrailVerdict: { allowed: false, vetoedBy: 'QUIET_HOURS', reason: '02:00 local' },
        }),
      },
    )

    expect(out).toEqual({ executed: false, reason: 'vetoed' })
    expect(store.calls).toEqual(['veto'])
    expect(executed).toBe(false)
  })

  it('does nothing at all when the playbook proposed no action', async () => {
    const store = new RecordingStore()
    const executors = registry({})

    const out = await executeDecision(
      { store, executors },
      { ...input, decision: decision({ proposedAction: null }) },
    )

    expect(out).toEqual({ executed: false, reason: 'no_action' })
    expect(store.calls).toEqual([])
  })
})

describe('executor selection', () => {
  it('dispatches on the action type', async () => {
    const seen: string[] = []
    const executors: ExecutorRegistry = {
      retry_charge: { type: 'retry_charge', execute: async () => { seen.push('retry_charge'); return { status: 'accepted', providerRef: null, detail: {} } } },
      issue_payment_link: { type: 'issue_payment_link', execute: async () => { seen.push('issue_payment_link'); return { status: 'accepted', providerRef: null, detail: {} } } },
      send_nudge: { type: 'send_nudge', execute: async () => { seen.push('send_nudge'); return { status: 'accepted', providerRef: null, detail: {} } } },
      escalate: { type: 'escalate', execute: async () => { seen.push('escalate'); return { status: 'accepted', providerRef: null, detail: {} } } },
    }

    for (const type of ['retry_charge', 'issue_payment_link', 'send_nudge', 'escalate'] as const) {
      const store = new RecordingStore()
      await executeDecision(
        { store, executors },
        {
          ...input,
          decision: decision({
            proposedAction: {
              type,
              scheduledFor: null,
              idempotencyKey: `pay_1:0:${type}`,
              payload: {},
            },
          }),
        },
      )
    }

    expect(seen).toEqual(['retry_charge', 'issue_payment_link', 'send_nudge', 'escalate'])
  })
})
