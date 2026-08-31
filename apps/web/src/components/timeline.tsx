import Link from 'next/link'
import type { PaymentTimeline, TimelineAction } from '@/lib/timeline'
import { methodLabel, offsetFrom, rupeesExact, stamp } from '@/lib/format'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label">{label}</span>
      <span className="num text-xs text-dim">{children}</span>
    </div>
  )
}

function Stage({
  index,
  title,
  tone,
  last,
  children,
}: {
  index: string
  title: string
  tone?: string
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="relative pb-6 pl-10">
      <span
        className={`absolute left-0 top-0 flex h-5 w-5 items-center justify-center border ${tone ?? 'border-border-strong text-faint'}`}
      >
        <span className="num text-[10px] leading-none">{index}</span>
      </span>
      {last !== true && (
        <span className="absolute bottom-0 left-[10px] top-5 w-px bg-border" />
      )}
      <h2 className="label mb-2 text-dim">{title}</h2>
      {children}
    </section>
  )
}

function KeyValues({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') {
    return <span className="num text-xs text-faint">—</span>
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return <span className="num text-xs text-faint">—</span>

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="num text-xs text-faint">{k}</dt>
          <dd className="num break-all text-xs text-dim">
            {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ActionBlock({
  action,
  failedAt,
  stageIndex,
  actionNumber,
  last,
}: {
  action: TimelineAction
  failedAt: Date
  stageIndex: number
  actionNumber: number
  last: boolean
}) {
  const vetoed = action.status === 'vetoed'
  const at = action.executedAt ?? action.scheduledFor

  return (
    <Stage
      index={String(stageIndex)}
      title={`action ${actionNumber}`}
      tone={vetoed ? 'border-veto text-veto' : 'border-border-strong text-faint'}
      last={last}
    >
      <div
        className={`border-l-2 bg-surface px-3 py-2.5 ${vetoed ? 'border-l-veto' : 'border-l-accent'}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span
            className={`num text-base ${vetoed ? 'text-veto line-through' : 'text-text'}`}
          >
            {action.type}
          </span>
          <span
            className={`text-[10px] uppercase tracking-[0.09em] ${vetoed ? 'text-veto' : action.status === 'succeeded' ? 'text-ok' : 'text-accent'}`}
          >
            {vetoed ? 'vetoed' : action.status}
          </span>
          {at !== null && (
            <span className="num ml-auto text-xs text-faint">
              {offsetFrom(failedAt, at)} · {stamp(at)}
            </span>
          )}
        </div>

        {vetoed ? (
          <div className="mt-2.5 border border-veto/40 bg-veto/5 px-2.5 py-2">
            <div className="flex items-baseline gap-2">
              <span className="label text-veto">blocked by</span>
              <span className="num text-sm text-veto">{action.vetoedBy}</span>
            </div>
            <p className="num mt-1 text-xs text-dim">{action.vetoReason}</p>
            <p className="mt-1.5 text-xs text-faint">
              The action was proposed by the playbook, written to the audit log, and never
              executed.
            </p>
          </div>
        ) : (
          <div className="mt-2.5 grid grid-cols-2 gap-x-8 gap-y-2">
            <Field label="guardrail verdict">
              <span className="text-ok">allowed</span>
            </Field>
            <Field label="idempotency key">{action.idempotencyKey}</Field>
            <div className="flex flex-col gap-0.5">
              <span className="label">payload</span>
              <KeyValues value={action.payload} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="label">outcome</span>
              <KeyValues value={action.outcome} />
            </div>
          </div>
        )}
      </div>
    </Stage>
  )
}

export function Timeline({ payment }: { payment: PaymentTimeline }) {
  const d = payment.diagnosis

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-5">
      <div className="mb-6 flex flex-wrap items-end gap-x-10 gap-y-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <Link href="/" className="label text-faint hover:text-accent">
            ← board
          </Link>
          <span className="num text-md text-text">{payment.razorpayPaymentId}</span>
        </div>
        <Field label="amount">
          <span className="text-md text-text">₹{rupeesExact(payment.amountPaise)}</span>
        </Field>
        <Field label="method">{methodLabel(payment.method)}</Field>
        <Field label="attempt">#{payment.attemptNumber}</Field>
        <Field label="customer">{payment.customer.externalId}</Field>
        <Field label="timezone">{payment.customer.timezone}</Field>
        <Field label="opted out">{payment.customer.optedOut ? 'yes' : 'no'}</Field>
        <div className="ml-auto flex flex-col items-end gap-0.5">
          <span className="label">status</span>
          <span className="num text-md text-text">{payment.status}</span>
        </div>
      </div>

      <Stage index="1" title="failure">
        <div className="border-l-2 border-l-border-strong bg-surface px-3 py-2.5">
          <div className="grid grid-cols-3 gap-x-8 gap-y-2">
            <Field label="reason">
              <span className="text-text">{payment.error.reason ?? '—'}</span>
            </Field>
            <Field label="source">{payment.error.source ?? '—'}</Field>
            <Field label="step">{payment.error.step ?? '—'}</Field>
            <Field label="code">{payment.error.code ?? '—'}</Field>
            <Field label="failed at">{stamp(payment.failedAt)}</Field>
            <Field label="order">{payment.razorpayOrderId ?? '—'}</Field>
          </div>
          {payment.error.description !== null && (
            <p className="mt-2 border-t pt-2 text-xs text-dim">
              {payment.error.description}
            </p>
          )}
          <p className="mt-2 text-xs text-faint">
            Raw, as Razorpay returned it. <span className="num">reason</span> is the only
            field classified on; <span className="num">code</span> is too coarse to carry
            information.
          </p>
        </div>
      </Stage>

      <Stage index="2" title="diagnosis">
        {d === null ? (
          <p className="text-sm text-faint">
            Not diagnosed yet. This payment has not been picked up by a batch run.
          </p>
        ) : (
          <div className="border-l-2 border-l-border-strong bg-surface px-3 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <span className="num text-md text-text">{d.rootCause}</span>
              <span className="flex items-baseline gap-1.5">
                <span className="label">confidence</span>
                <span className="num text-sm text-dim">{d.confidence.toFixed(2)}</span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="label">classifier</span>
                <span
                  className={`num text-sm ${d.classifier === 'llm' ? 'text-accent' : 'text-dim'}`}
                >
                  {d.classifier}
                </span>
              </span>
              {d.llmModel !== null && (
                <span className="num text-xs text-faint">{d.llmModel}</span>
              )}
            </div>

            <div className="mt-2.5 border-t pt-2">
              <span className="label">evidence</span>
              <ol className="mt-1 flex flex-col gap-0.5">
                {d.evidence.map((line, i) => (
                  <li key={i} className="num flex gap-2 text-xs text-dim">
                    <span className="text-faint">{String(i + 1).padStart(2, '0')}</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </div>

            {d.llmRawResponse !== null && (
              <details className="mt-2 border-t pt-2">
                <summary className="label cursor-pointer hover:text-dim">
                  raw model response
                </summary>
                <pre className="num mt-1.5 overflow-x-auto whitespace-pre-wrap break-all text-xs text-faint">
                  {d.llmRawResponse}
                </pre>
              </details>
            )}
          </div>
        )}
      </Stage>

      <Stage index="3" title="playbook">
        {payment.playbook === null ? (
          <p className="text-sm text-faint">No playbook resolved without a diagnosis.</p>
        ) : (
          <div className="border-l-2 border-l-border-strong bg-surface px-3 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="num text-sm text-text">{payment.playbook.rootCause}</span>
              <span className="num text-xs text-faint">
                max {payment.playbook.maxRetries} retries · max{' '}
                {payment.playbook.maxContacts} contacts · cooldown{' '}
                {Math.round(payment.playbook.cooldownMs / 60000)}m · terminal{' '}
                {payment.playbook.terminal}
              </span>
            </div>
            {payment.playbook.steps.length === 0 ? (
              <p className="mt-2 text-xs text-dim">
                No steps. This playbook acts by escalating rather than by intervening.
              </p>
            ) : (
              <ol className="mt-2 flex flex-col gap-1 border-t pt-2">
                {payment.playbook.steps.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span className="num text-faint">{i + 1}</span>
                    <span className="num text-dim">{s.detail}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Stage>

      {payment.actions.length === 0 ? (
        <Stage index="4" title="actions" last>
          <p className="text-sm text-faint">
            No actions were proposed. The playbook for this cause acts by escalating, or
            the payment has not been picked up by a batch run yet.
          </p>
        </Stage>
      ) : (
        payment.actions.map((a, i) => (
          <ActionBlock
            key={a.id}
            action={a}
            stageIndex={i + 4}
            actionNumber={i + 1}
            failedAt={payment.failedAt}
            last={i === payment.actions.length - 1}
          />
        ))
      )}

      <section className="mt-4 border-t pt-5">
        <h2 className="label mb-2 text-dim">audit log</h2>
        <p className="mb-3 text-xs text-faint">
          Append-only. <span className="num">occurred at</span> is simulated-clock time;{' '}
          <span className="num">wall clock</span> is when the row was actually written, so
          a time-warped run stays traceable.
        </p>
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[150px]" />
            <col className="w-[124px]" />
            <col className="w-[124px]" />
            <col className="w-[150px]" />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b bg-raised">
              <th className="label px-2 py-1.5 text-left font-normal">event</th>
              <th className="label px-2 py-1.5 text-left font-normal">occurred at</th>
              <th className="label px-2 py-1.5 text-left font-normal">wall clock</th>
              <th className="label px-2 py-1.5 text-left font-normal">rule fired</th>
              <th className="label px-2 py-1.5 text-left font-normal">reasoning</th>
            </tr>
          </thead>
          <tbody>
            {payment.logs.map((log) => (
              <tr key={log.id} className="border-b border-border/60 align-top">
                <td
                  className={`num px-2 py-1 text-xs ${log.event === 'action_vetoed' ? 'text-veto' : 'text-dim'}`}
                >
                  {log.event}
                </td>
                <td className="num px-2 py-1 text-xs text-dim">{stamp(log.occurredAt)}</td>
                <td className="num px-2 py-1 text-xs text-faint">
                  {stamp(log.wallClockAt)}
                </td>
                <td className="num px-2 py-1 text-xs text-dim">{log.ruleFired ?? '—'}</td>
                <td className="num px-2 py-1 text-xs text-faint">
                  <span className="line-clamp-3" title={log.reasoning ?? ''}>
                    {log.reasoning ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
