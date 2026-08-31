import { notFound } from 'next/navigation'
import { Timeline } from '@/components/timeline'
import { loadTimeline } from '@/lib/timeline'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const payment = await loadTimeline(id)
    if (payment === null) notFound()
    return <Timeline payment={payment} />
  } catch (err) {
    if ((err as { digest?: string }).digest === 'NEXT_NOT_FOUND') throw err
    return (
      <main className="px-4 py-10">
        <p className="text-md">This timeline could not load.</p>
        <p className="num mt-2 text-sm text-faint">{(err as Error).message.slice(0, 300)}</p>
      </main>
    )
  }
}
