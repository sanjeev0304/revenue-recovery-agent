import { BoardTable } from '@/components/board-table'
import { loadBoard } from '@/lib/board'

export const dynamic = 'force-dynamic'

export default async function Page() {
  try {
    const board = await loadBoard()
    return <BoardTable initial={board} />
  } catch (err) {
    return (
      <main className="px-4 py-10">
        <p className="text-md">The recovery board could not load.</p>
        <p className="num mt-2 text-sm text-faint">{(err as Error).message.slice(0, 300)}</p>
        <p className="mt-4 text-sm text-dim">
          The board reads the train split from Postgres. Check that the database is
          reachable and that <code className="num text-faint">npm run seed</code> has run.
        </p>
      </main>
    )
  }
}
