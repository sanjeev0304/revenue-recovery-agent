import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-md">No such payment.</h1>
      <p className="mt-2 text-sm text-dim">
        Nothing in the train split matches that id.
      </p>
      <Link href="/" className="label mt-4 inline-block text-faint hover:text-accent">
        ← board
      </Link>
    </main>
  )
}
