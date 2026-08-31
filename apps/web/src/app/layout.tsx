import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Revenue Recovery Agent',
  description: 'Diagnose failed payments, recover revenue within hard limits.',
}

const NAV = [
  { href: '/', label: 'board' },
  { href: '/metrics', label: 'metrics' },
]

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-30 flex h-11 items-center gap-6 border-b bg-bg px-4">
          <Link href="/" className="label text-text no-underline">
            Revenue Recovery
          </Link>
          <nav className="flex items-center gap-4">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-dim transition-colors hover:text-text"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="num ml-auto text-xs text-faint">
            dataset v1 · test mode
          </span>
        </header>
        {children}
      </body>
    </html>
  )
}
