'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { Board, BoardRow, BoardStatus } from '@/lib/board'
import { methodLabel, offsetFrom, rupees, stamp } from '@/lib/format'

const STATUS_FILTERS: readonly (BoardStatus | 'all')[] = [
  'all',
  'failed',
  'in_progress',
  'recovered',
  'escalated',
  'abandoned',
]

const STATUS_LABEL: Record<BoardStatus, string> = {
  failed: 'failed',
  in_progress: 'in prog',
  recovered: 'recov',
  escalated: 'escal',
  abandoned: 'abandon',
}

const RAIL: Record<BoardStatus, string> = {
  failed: 'bg-border',
  in_progress: 'bg-accent',
  recovered: 'bg-ok',
  escalated: 'bg-esc',
  abandoned: 'bg-border',
}

const STATUS_TEXT: Record<BoardStatus, string> = {
  failed: 'text-dim',
  in_progress: 'text-accent',
  recovered: 'text-ok',
  escalated: 'text-esc',
  abandoned: 'text-faint',
}

function StatusCell({ status }: { status: BoardStatus }) {
  const marker =
    status === 'escalated' ? (
      <span className="inline-block h-[7px] w-[7px] bg-esc" />
    ) : status === 'in_progress' || status === 'recovered' ? (
      <span
        className={`inline-block h-[5px] w-[5px] rounded-full ${status === 'recovered' ? 'bg-ok' : 'bg-accent'}`}
      />
    ) : (
      <span className="inline-block h-[5px] w-[5px] rounded-full bg-border-strong" />
    )

  return (
    <span className="flex items-center gap-1.5">
      {marker}
      <span
        className={`text-[10px] uppercase tracking-[0.09em] ${STATUS_TEXT[status]}`}
      >
        {STATUS_LABEL[status]}
      </span>
    </span>
  )
}

function Counter({
  label,
  value,
  of,
  tone,
}: {
  label: string
  value: string
  of?: string
  tone?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <span className="num text-lg leading-none">
        <span className={tone ?? 'text-text'}>{value}</span>
        {of !== undefined && <span className="text-faint">/{of}</span>}
      </span>
    </div>
  )
}

export function BoardTable({ initial }: { initial: Board }) {
  const [board, setBoard] = useState(initial)
  const [status, setStatus] = useState<BoardStatus | 'all'>('all')
  const [cause, setCause] = useState<string>('all')
  const [live, setLive] = useState(true)
  const [stale, setStale] = useState(false)
  const [changed, setChanged] = useState<Set<string>>(new Set())

  const previous = useRef(new Map(initial.rows.map((r) => [r.id, r.status])))

  useEffect(() => {
    if (!live) return
    let cancelled = false

    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/board', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const next = (await res.json()) as Board
        if (cancelled) return

        const moved = new Set<string>()
        for (const row of next.rows) {
          const before = previous.current.get(row.id)
          if (before !== undefined && before !== row.status) moved.add(row.id)
          previous.current.set(row.id, row.status)
        }

        setBoard(next)
        setStale(false)
        if (moved.size > 0) {
          setChanged(moved)
          setTimeout(() => {
            if (!cancelled) setChanged(new Set())
          }, 700)
        }
      } catch {
        if (!cancelled) setStale(true)
      }
    }

    const id = setInterval(tick, 1500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [live])

  const rows = useMemo(
    () =>
      board.rows.filter(
        (r) =>
          (status === 'all' || r.status === status) &&
          (cause === 'all' || r.cause === cause),
      ),
    [board.rows, status, cause],
  )

  const c = board.counters

  return (
    <main className="px-4 pb-16">
      <section className="flex items-end gap-10 border-b py-4">
        <Counter
          label="recovered"
          value={String(c.recovered)}
          of={String(c.total)}
          tone="text-ok"
        />
        <Counter label="in progress" value={String(c.inProgress)} tone="text-accent" />
        <Counter label="escalated" value={String(c.escalated)} tone="text-esc" />
        <Counter label="untouched" value={String(c.failed)} tone="text-dim" />
        <div className="ml-auto flex flex-col items-end gap-1">
          <span className="label">money recovered</span>
          <span className="num text-lg leading-none">
            <span className="text-faint">₹</span>
            <span className="text-ok">{rupees(c.recoveredPaise)}</span>
            <span className="text-faint"> of ₹{rupees(c.totalPaise)}</span>
          </span>
        </div>
      </section>

      <section className="flex items-center gap-6 border-b py-2.5">
        <div className="flex items-center gap-2">
          <span className="label w-10">status</span>
          <div className="flex gap-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`border px-2 py-0.5 text-xs transition-colors ${
                  status === s
                    ? 'border-accent bg-accent-quiet text-text'
                    : 'border-border text-dim hover:border-border-strong hover:text-text'
                }`}
              >
                {s === 'all' ? 'all' : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="label w-10">cause</span>
          <select
            value={cause}
            onChange={(e) => setCause(e.target.value)}
            className="num border border-border bg-surface px-2 py-0.5 text-xs text-dim focus:border-accent focus:outline-none"
          >
            <option value="all">all causes</option>
            {board.causes.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>

        <div className="num ml-auto flex items-center gap-4 text-xs text-faint">
          <span>
            {rows.length} shown{rows.length !== c.total && ` of ${c.total}`}
          </span>
          {board.truncated && <span className="text-esc">list truncated</span>}
          {stale && <span className="text-esc">poll failed, showing last good data</span>}
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className={`border px-2 py-0.5 ${
              live ? 'border-accent text-accent' : 'border-border text-faint'
            }`}
          >
            {live ? 'live' : 'paused'}
          </button>
        </div>
      </section>

      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[3px]" />
          <col className="w-[104px]" />
          <col className="w-[92px]" />
          <col className="w-[44px]" />
          <col className="w-[168px]" />
          <col className="w-[202px]" />
          <col className="w-[74px]" />
          <col className="w-[86px]" />
          <col />
          <col className="w-[92px]" />
        </colgroup>
        <thead>
          <tr className="border-b bg-raised">
            <th />
            <th className="label px-2 py-1.5 text-left font-normal">payment id</th>
            <th className="label px-2 py-1.5 text-right font-normal">amount</th>
            <th className="label px-2 py-1.5 text-left font-normal">m</th>
            <th className="label px-2 py-1.5 text-left font-normal">razorpay reason</th>
            <th className="label px-2 py-1.5 text-left font-normal">diagnosed cause</th>
            <th className="label px-2 py-1.5 text-left font-normal">conf</th>
            <th className="label px-2 py-1.5 text-left font-normal">status</th>
            <th className="label px-2 py-1.5 text-left font-normal">next action</th>
            <th className="label px-2 py-1.5 text-right font-normal">when</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.id} row={row} flashing={changed.has(row.id)} />
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="py-10 text-center text-sm text-faint">
          No payments match this filter.
        </p>
      )}
    </main>
  )
}

function Row({ row, flashing }: { row: BoardRow; flashing: boolean }) {
  const failedAt = new Date(row.failedAt)
  const at = row.next?.scheduledFor === undefined ? null : row.next.scheduledFor
  const when = at === null || at === undefined ? null : new Date(at)
  const vetoed = row.next?.vetoedBy ?? null

  return (
    <tr
      className={`group border-b border-border/60 hover:bg-raised ${flashing ? 'flash' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '30px' }}
    >
      <td className={`p-0 ${RAIL[row.status]}`} />
      <td className="px-2 py-1">
        <Link
          href={`/payments/${row.id}`}
          className="num text-xs text-dim underline-offset-2 hover:text-accent hover:underline"
        >
          {row.razorpayPaymentId}
        </Link>
      </td>
      <td className="num px-2 py-1 text-right text-sm">
        <span className="text-faint">₹</span>
        {rupees(row.amountPaise)}
      </td>
      <td className="px-2 py-1 text-[10px] uppercase tracking-[0.09em] text-faint">
        {methodLabel(row.method)}
      </td>
      <td className="num truncate px-2 py-1 text-xs text-dim" title={row.reason ?? ''}>
        {row.reason ?? '—'}
      </td>
      <td className="truncate px-2 py-1 text-sm">
        {row.cause === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span
              className="border border-border-strong px-1 text-[9px] leading-[13px] text-faint"
              title={row.classifier === 'llm' ? 'classified by the model' : 'deterministic lookup'}
            >
              {row.classifier === 'llm' ? 'L' : 'D'}
            </span>
            <span className="truncate text-dim">{row.cause}</span>
          </span>
        )}
      </td>
      <td className="px-2 py-1">
        {row.confidence === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="num text-xs text-dim">{row.confidence.toFixed(2)}</span>
            <span className="h-[3px] w-5 bg-border">
              <span
                className="block h-full bg-accent"
                style={{ width: `${Math.round(row.confidence * 100)}%` }}
              />
            </span>
          </span>
        )}
      </td>
      <td className="px-2 py-1">
        <StatusCell status={row.status} />
      </td>
      <td className="px-2 py-1">
        {row.next === null ? (
          <span className="text-faint">—</span>
        ) : vetoed !== null ? (
          <span className="flex flex-col leading-tight">
            <span className="num text-xs text-veto line-through">{row.next.type}</span>
            <span className="num text-[10px] text-veto/80">{vetoed}</span>
          </span>
        ) : (
          <span className="num text-xs text-dim">{row.next.type}</span>
        )}
      </td>
      <td className="px-2 py-1 text-right">
        {when === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="num flex flex-col leading-tight">
            <span className="text-xs text-dim">{offsetFrom(failedAt, when)}</span>
            <span className="text-[10px] text-faint">{stamp(when)}</span>
          </span>
        )}
      </td>
    </tr>
  )
}
