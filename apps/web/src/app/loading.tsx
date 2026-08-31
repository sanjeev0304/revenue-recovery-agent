import { LoadingNote, Shimmer, SkeletonRows } from '@/components/skeleton'

export default function Loading() {
  return (
    <main className="px-4 pb-16">
      <section className="flex items-end gap-10 border-b py-4">
        {['recovered', 'in progress', 'escalated', 'untouched'].map((label) => (
          <div key={label} className="flex flex-col gap-2">
            <span className="label">{label}</span>
            <Shimmer className="h-4 w-16" />
          </div>
        ))}
        <div className="ml-auto flex flex-col items-end gap-2">
          <span className="label">money recovered</span>
          <Shimmer className="h-4 w-40" />
        </div>
      </section>
      <section className="flex items-center gap-6 border-b py-3">
        <LoadingNote>reading the train split</LoadingNote>
      </section>
      <SkeletonRows count={18} height="h-[34px]" />
    </main>
  )
}
