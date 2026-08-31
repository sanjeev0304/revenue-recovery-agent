import { LoadingNote, Shimmer } from '@/components/skeleton'

export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-5">
      <div className="mb-6 flex flex-wrap items-end gap-x-10 gap-y-3 border-b pb-4">
        <Shimmer className="h-4 w-32" />
        <Shimmer className="h-4 w-24" />
        <Shimmer className="h-4 w-16" />
        <Shimmer className="ml-auto h-4 w-20" />
      </div>
      {['failure', 'diagnosis', 'playbook'].map((title, i) => (
        <section key={title} className="relative pb-6 pl-10">
          <span className="absolute left-0 top-0 h-5 w-5 border border-border-strong" />
          {i < 2 && <span className="absolute bottom-0 left-[10px] top-5 w-px bg-border" />}
          <h2 className="label mb-2 text-dim">{title}</h2>
          <div className="border-l-2 border-l-border-strong bg-surface px-3 py-3">
            <Shimmer className="h-2 w-2/3" />
            <Shimmer className="mt-2 h-2 w-1/2" />
          </div>
        </section>
      ))}
      <LoadingNote>reading the audit trail</LoadingNote>
    </main>
  )
}
