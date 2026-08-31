import { Metrics } from '@/components/metrics'
import { loadResults } from '@/lib/results'

export const dynamic = 'force-dynamic'

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-md">{title}</h1>
      <div className="mt-3 flex flex-col gap-3 text-sm text-dim">{children}</div>
    </main>
  )
}

export default async function Page() {
  const state = await loadResults()

  if (state.kind === 'missing') {
    return (
      <Empty title="Nothing has been measured yet.">
        <p>
          This screen reads <span className="num text-faint">docs/results.json</span>,
          which is written by the eval harness. That file does not exist, so there are no
          numbers to show — and none will be invented here.
        </p>
        <pre className="num border-l-2 border-l-accent bg-surface px-3 py-2 text-xs text-dim">
          npm run eval
        </pre>
        <p className="text-xs text-faint">
          The run scores baseline, agent and majority-class arms over the train split,
          plus a paired LLM on/off comparison, and writes both{' '}
          <span className="num">docs/results.md</span> and{' '}
          <span className="num">docs/results.json</span>.
        </p>
      </Empty>
    )
  }

  if (state.kind === 'invalid') {
    return (
      <Empty title="results.json could not be read.">
        <p>
          The file exists but does not match the expected shape, so nothing is rendered
          rather than rendering something misleading.
        </p>
        <pre className="num border-l-2 border-l-veto bg-surface px-3 py-2 text-xs text-veto">
          {state.error}
        </pre>
        <p className="text-xs text-faint">
          Re-run <span className="num">npm run eval</span> to regenerate it.
        </p>
      </Empty>
    )
  }

  return <Metrics results={state.results} />
}
