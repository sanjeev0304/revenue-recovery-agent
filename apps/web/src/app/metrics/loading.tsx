import { LoadingNote, Shimmer } from '@/components/skeleton'

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-20 pt-5">
      <div className="flex flex-wrap items-baseline gap-x-8 border-b pb-4">
        <h1 className="text-md">Measured recovery</h1>
      </div>
      <section className="border-l-2 border-l-accent bg-surface px-5 py-5">
        <span className="label text-accent">baseline vs agent</span>
        <div className="mt-5 grid grid-cols-3 gap-x-10">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-3">
              <Shimmer className="h-2 w-28" />
              <Shimmer className="h-6 w-32" />
              <Shimmer className="h-[5px] w-full" />
              <Shimmer className="h-4 w-24" />
              <Shimmer className="h-[5px] w-full" />
            </div>
          ))}
        </div>
      </section>
      <LoadingNote>reading docs/results.json</LoadingNote>
    </main>
  )
}
