import type { ArmMetrics, EvalResults, MatrixCell } from '@/lib/results'
import { money, rupees } from '@/lib/format'

function Counted({
  n,
  d,
  tone,
}: {
  n: number
  d: number
  tone?: string
}) {
  return (
    <span className="num">
      <span className={tone ?? 'text-text'}>{n}</span>
      <span className="text-faint">/{d}</span>
      <span className="text-dim"> ({d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`})</span>
    </span>
  )
}

function Money({ paise, tone }: { paise: number; tone?: string }) {
  return (
    <span className="num">
      <span className="text-faint">₹</span>
      <span className={tone ?? 'text-text'}>{rupees(paise)}</span>
    </span>
  )
}

function Delta({ value, goodWhen }: { value: number; goodWhen: 'up' | 'down' }) {
  if (value === 0) return <span className="num text-faint">no change</span>
  const good = goodWhen === 'up' ? value > 0 : value < 0
  return (
    <span className={`num ${good ? 'text-ok' : 'text-esc'}`}>
      {value > 0 ? '+' : ''}
      {value}
    </span>
  )
}

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const width = max === 0 ? 0 : Math.max(1, Math.round((100 * value) / max))
  return (
    <span className="block h-[3px] w-full bg-border">
      <span className={`block h-full ${tone}`} style={{ width: `${width}%` }} />
    </span>
  )
}

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t pt-5">
      <h2 className="label mb-1 text-dim">{title}</h2>
      {note !== undefined && <p className="mb-3 max-w-4xl text-xs text-faint">{note}</p>}
      {children}
    </section>
  )
}

function ArmCard({ arm, best }: { arm: ArmMetrics; best: number }) {
  const isAgent = arm.key === 'agent'
  return (
    <div
      className={`border-l-2 bg-surface px-3 py-3 ${isAgent ? 'border-l-accent' : 'border-l-border-strong'}`}
    >
      <h3 className={`num text-sm ${isAgent ? 'text-accent' : 'text-dim'}`}>{arm.label}</h3>

      <div className="mt-3 flex flex-col gap-0.5">
        <span className="label">payments recovered</span>
        <span className="num text-xl leading-none">
          <span className={isAgent ? 'text-accent' : 'text-text'}>{arm.recovered}</span>
          <span className="text-faint">/{arm.processed}</span>
        </span>
        <span className="num text-xs text-dim">
          {((100 * arm.recovered) / arm.processed).toFixed(1)}%
        </span>
        <span className="mt-1.5">
          <Bar value={arm.recovered} max={best} tone={isAgent ? 'bg-accent' : 'bg-border-strong'} />
        </span>
      </div>

      <dl className="mt-3 flex flex-col gap-1.5 border-t pt-2.5">
        <Stat label="money recovered">
          <Money paise={arm.recoveredPaise} tone={isAgent ? 'text-accent' : 'text-text'} />
          <span className="num text-faint"> of ₹{rupees(arm.totalPaise)}</span>
        </Stat>
        <Stat label="charge attempts">
          <span className="num text-dim">{arm.chargeAttempts}</span>
        </Stat>
        <Stat label="wasted attempts">
          <span className="num text-esc">{arm.wastedChargeAttempts}</span>
          <span className="num text-faint"> of {arm.chargeAttempts}</span>
        </Stat>
        <Stat label="attempts per recovery">
          <span className="num text-dim">
            {arm.recovered === 0 ? 'n/a' : (arm.chargeAttempts / arm.recovered).toFixed(2)}
          </span>
        </Stat>
        <Stat label="contacts sent">
          <span className="num text-dim">{arm.contacts}</span>
        </Stat>
        <Stat label="escalated">
          <span className="num text-dim">{arm.escalated}</span>
        </Stat>
        <Stat label="quiet-hours violations">
          <span className={`num ${arm.quietHoursViolations === 0 ? 'text-ok' : 'text-esc'}`}>
            {arm.quietHoursViolations}
          </span>
        </Stat>
        <Stat label="operational cost">
          <Money paise={arm.operationalCostPaise} tone="text-dim" />
        </Stat>
      </dl>
    </div>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label">{label}</dt>
      <dd className="text-xs">{children}</dd>
    </div>
  )
}

function MatrixTable({ cells, caption }: { cells: MatrixCell[]; caption: string }) {
  if (cells.length === 0) {
    return <p className="text-xs text-faint">No cells in this group.</p>
  }
  return (
    <>
      <p className="label mb-1.5">{caption}</p>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[190px]" />
          <col className="w-[190px]" />
          <col className="w-[44px]" />
          <col className="w-[96px]" />
          <col className="w-[110px]" />
          <col className="w-[96px]" />
          <col className="w-[64px]" />
          <col className="w-[80px]" />
        </colgroup>
        <thead>
          <tr className="border-b bg-raised">
            <th className="label px-2 py-1.5 text-left font-normal">predicted</th>
            <th className="label px-2 py-1.5 text-left font-normal">true</th>
            <th className="label px-2 py-1.5 text-right font-normal">n</th>
            <th className="label px-2 py-1.5 text-right font-normal">recovered</th>
            <th className="label px-2 py-1.5 text-right font-normal">oracle would</th>
            <th className="label px-2 py-1.5 text-right font-normal">shortfall</th>
            <th className="label px-2 py-1.5 text-right font-normal">wasted</th>
            <th className="label px-2 py-1.5 text-right font-normal">cost</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr
              key={`${c.predicted}|${c.trueCause}`}
              className="border-b border-border/60 hover:bg-raised"
            >
              <td className="num truncate px-2 py-1 text-xs text-dim">{c.predicted}</td>
              <td
                className={`num truncate px-2 py-1 text-xs ${c.predicted === c.trueCause ? 'text-dim' : 'text-esc'}`}
              >
                {c.trueCause}
              </td>
              <td className="num px-2 py-1 text-right text-xs text-dim">{c.n}</td>
              <td className="num px-2 py-1 text-right text-xs text-dim">
                {money(c.recoveredPaise)}
              </td>
              <td className="num px-2 py-1 text-right text-xs text-faint">
                {money(c.oracleRecoveredPaise)}
              </td>
              <td
                className={`num px-2 py-1 text-right text-xs ${c.shortfallPaise > 0 ? 'text-esc' : 'text-faint'}`}
              >
                {money(c.shortfallPaise)}
              </td>
              <td className="num px-2 py-1 text-right text-xs text-dim">
                {c.wastedChargeAttempts}
              </td>
              <td className="num px-2 py-1 text-right text-xs text-faint">
                {money(c.costPaise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function Metrics({ results }: { results: EvalResults }) {
  const byKey = new Map(results.arms.map((a) => [a.key, a]))
  const baseline = byKey.get('baseline')
  const agent = byKey.get('agent')
  const majority = byKey.get('majority_class')
  const noLlm = byKey.get('agent_no_llm')
  const cmp = results.llmComparison

  if (baseline === undefined || agent === undefined || majority === undefined || noLlm === undefined) {
    return (
      <main className="px-4 py-10">
        <p className="text-md">results.json is missing one of the four arms.</p>
        <p className="num mt-2 text-sm text-faint">
          found: {results.arms.map((a) => a.key).join(', ')}
        </p>
      </main>
    )
  }

  const reported = [baseline, agent, majority]
  const best = Math.max(...reported.map((a) => a.recovered))

  const errors = results.confusion.filter((c) => c.predicted !== c.trueCause)
  const correct = results.confusion.filter((c) => c.predicted === c.trueCause)
  const totalShortfall = errors.reduce((a, c) => a + c.shortfallPaise, 0)
  const totalWasted = errors.reduce((a, c) => a + c.wastedChargeAttempts, 0)

  const opaque = results.opaque['agent']
  const modelGain = agent.recovered - majority.recovered
  const modelGainPaise = agent.recoveredPaise - majority.recoveredPaise

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-20 pt-5">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b pb-4">
        <h1 className="text-md">Measured recovery</h1>
        <span className="num text-xs text-faint">
          dataset {results.datasetVersion} · {results.split} split · {results.recordCount}{' '}
          records · generated {results.generatedAt.slice(0, 16).replace('T', ' ')}
        </span>
        <span className="num ml-auto text-xs text-faint">
          from docs/results.json — written by npm run eval, never by hand
        </span>
      </div>

      <section className="border-l-2 border-l-accent bg-surface px-4 py-4">
        <h2 className="label mb-2 text-accent">finding — what the model actually buys</h2>
        <p className="max-w-4xl text-base text-dim">
          Turning the model on recovers more money and more payments. It also classifies
          slightly <em className="not-italic text-text">worse</em> and burns roughly twice
          the attempts on payments that could never have recovered. The recovery comes
          from the playbooks running at all, not from the labels being right.
        </p>

        <table className="mt-4 w-full max-w-4xl table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-[170px]" />
            <col className="w-[170px]" />
            <col className="w-[110px]" />
          </colgroup>
          <thead>
            <tr className="border-b">
              <th className="label px-2 py-1.5 text-left font-normal" />
              <th className="label px-2 py-1.5 text-right font-normal">LLM off</th>
              <th className="label px-2 py-1.5 text-right font-normal">LLM on</th>
              <th className="label px-2 py-1.5 text-right font-normal">change</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60">
              <td className="px-2 py-1.5 text-xs text-dim">payments recovered</td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Counted n={cmp.recoveredOff} d={results.recordCount} />
              </td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Counted n={cmp.recoveredOn} d={results.recordCount} tone="text-accent" />
              </td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Delta value={cmp.recoveredOn - cmp.recoveredOff} goodWhen="up" />
              </td>
            </tr>
            <tr className="border-b border-border/60">
              <td className="px-2 py-1.5 text-xs text-dim">money recovered</td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Money paise={cmp.recoveredPaiseOff} />
              </td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Money paise={cmp.recoveredPaiseOn} tone="text-accent" />
              </td>
              <td
                className={`num px-2 py-1.5 text-right text-xs ${cmp.recoveredPaiseOn >= cmp.recoveredPaiseOff ? 'text-ok' : 'text-esc'}`}
              >
                {cmp.recoveredPaiseOn >= cmp.recoveredPaiseOff ? '+' : ''}
                {money(cmp.recoveredPaiseOn - cmp.recoveredPaiseOff)}
              </td>
            </tr>
            <tr className="border-b border-border/60">
              <td className="px-2 py-1.5 text-xs text-dim">classification accuracy</td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Counted n={cmp.correctOff} d={cmp.classifiedTotal} />
              </td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Counted n={cmp.correctOn} d={cmp.classifiedTotal} />
              </td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Delta value={cmp.correctOn - cmp.correctOff} goodWhen="up" />
              </td>
            </tr>
            <tr className="border-b border-border/60">
              <td className="px-2 py-1.5 text-xs text-dim">wasted charge attempts</td>
              <td className="num px-2 py-1.5 text-right text-xs text-dim">{cmp.wastedOff}</td>
              <td className="num px-2 py-1.5 text-right text-xs text-esc">{cmp.wastedOn}</td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Delta value={cmp.wastedOn - cmp.wastedOff} goodWhen="down" />
              </td>
            </tr>
            <tr>
              <td className="px-2 py-1.5 text-xs text-dim">total charge attempts</td>
              <td className="num px-2 py-1.5 text-right text-xs text-dim">
                {cmp.chargeAttemptsOff}
              </td>
              <td className="num px-2 py-1.5 text-right text-xs text-dim">
                {cmp.chargeAttemptsOn}
              </td>
              <td className="px-2 py-1.5 text-right text-xs">
                <Delta value={cmp.chargeAttemptsOn - cmp.chargeAttemptsOff} goodWhen="down" />
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 border-t pt-3">
          <p className="label mb-1.5 text-esc">and the sharper version</p>
          <p className="max-w-4xl text-base text-dim">
            Guessing the majority label on every record the deterministic classifier
            defers on recovers{' '}
            <span className="num text-text">
              {majority.recovered}/{majority.processed}
            </span>{' '}
            and <Money paise={majority.recoveredPaise} tone="text-text" />. The model
            recovers{' '}
            <span className="num text-text">
              {agent.recovered}/{agent.processed}
            </span>{' '}
            and <Money paise={agent.recoveredPaise} tone="text-text" />. The model&rsquo;s
            entire contribution over guessing is{' '}
            <span className="num text-esc">{modelGain} payments</span> and{' '}
            <span className="num text-esc">{money(modelGainPaise)}</span>
            {opaque !== undefined && (
              <>
                {' '}
                — while scoring{' '}
                <span className="num text-esc">
                  {opaque.all.correct}/{opaque.all.total}
                </span>{' '}
                on the opaque subset against a majority-class baseline of{' '}
                <span className="num text-text">
                  {opaque.majorityCount}/{opaque.all.total}
                </span>
                , which is below it
              </>
            )}
            . On the one class the model exists to handle, it does not beat the guess.
          </p>
        </div>

        <p className="num mt-3 text-xs text-faint">
          LLM hit rate {cmp.llmHitRate.calls}/{cmp.llmHitRate.total} (
          {((100 * cmp.llmHitRate.calls) / cmp.llmHitRate.total).toFixed(1)}%) of records
          required a model call. PRD target was under 15%; see docs/EVAL-PLAN.md for why
          that is unreachable alongside a meaningful OPAQUE_BANK_DECLINE metric.
        </p>
      </section>

      <Section
        title="three arms"
        note="Baseline is the naive retry loop from docs/POLICY-SPEC.md: fixed +1h, +6h, +24h, max 3, no diagnosis and no guardrails. Majority class runs the full pipeline but replaces every model call with the majority label. Every rate carries its raw counts."
      >
        <div className="grid grid-cols-3 gap-3">
          {reported.map((arm) => (
            <ArmCard key={arm.key} arm={arm} best={best} />
          ))}
        </div>
        <p className="num mt-3 text-xs text-faint">
          A fourth run — {noLlm.label} — is the paired control for the finding above:{' '}
          {noLlm.recovered}/{noLlm.processed} recovered, {money(noLlm.recoveredPaise)},{' '}
          {noLlm.wastedChargeAttempts} wasted attempts.
        </p>
      </Section>

      <Section
        title="cost-weighted confusion matrix"
        note={`Every (predicted, true) cell is scored by running the predicted cause's playbook against that record's real recoverableUnder. "Oracle would" is the same records scored under a run that knew the true cause, so the shortfall is what the misclassification cost in money rather than in accuracy points. Across all misclassified cells: ${money(totalShortfall)} forgone and ${totalWasted} wasted charge attempts.`}
      >
        <div className="flex flex-col gap-5">
          <div>
            <MatrixTable
              cells={[...errors].sort((a, b) => b.shortfallPaise - a.shortfallPaise)}
              caption="errors, most expensive first"
            />
          </div>
          <div>
            <MatrixTable
              cells={[...correct].sort((a, b) => b.n - a.n)}
              caption="correct predictions"
            />
          </div>
        </div>
      </Section>

      {opaque !== undefined && (
        <Section
          title="the opaque subset"
          note="The class where the model does inference rather than confirming a lookup, so the honest test of whether it adds anything. Masked records carry an opaque reason but a different true cause."
        >
          <table className="w-full max-w-3xl table-fixed border-collapse">
            <colgroup>
              <col />
              <col className="w-[200px]" />
            </colgroup>
            <tbody>
              {[
                ['majority-class baseline', opaque.majorityCount, opaque.all.total, true],
                ['all opaque records', opaque.all.correct, opaque.all.total, false],
                ['genuinely opaque', opaque.genuine.correct, opaque.genuine.total, false],
                ['masked', opaque.masked.correct, opaque.masked.total, false],
                ['masked, inside a burst', opaque.maskedInBurst.correct, opaque.maskedInBurst.total, false],
                ['masked, scattered', opaque.maskedScattered.correct, opaque.maskedScattered.total, false],
              ].map(([label, n, d, isBaseline]) => (
                <tr key={label as string} className="border-b border-border/60">
                  <td
                    className={`px-2 py-1.5 text-xs ${isBaseline ? 'text-faint' : 'text-dim'}`}
                  >
                    {label as string}
                    {isBaseline === true && ' (the number to beat)'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs">
                    <Counted
                      n={n as number}
                      d={d as number}
                      tone={
                        isBaseline === true
                          ? 'text-text'
                          : (n as number) / Math.max(1, d as number) <
                              opaque.majorityCount / Math.max(1, opaque.all.total)
                            ? 'text-esc'
                            : 'text-ok'
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 max-w-4xl text-xs text-faint">
            Per-underlying-cause precision inside the masked subset is deliberately not
            reported: those records spread across eight causes with the rarest at one or
            two, and a precision figure on cells that small would be noise presented as
            measurement.
          </p>
        </Section>
      )}

      <Section title="cost assumptions">
        <ul className="flex max-w-4xl flex-col gap-1">
          {results.costAssumptions.map((a) => (
            <li key={a} className="num text-xs text-dim">
              — {a}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="how to read these numbers">
        <ul className="flex max-w-4xl flex-col gap-1.5">
          {results.caveats.map((c) => (
            <li key={c} className="text-xs text-faint">
              — {c}
            </li>
          ))}
        </ul>
      </Section>
    </main>
  )
}
