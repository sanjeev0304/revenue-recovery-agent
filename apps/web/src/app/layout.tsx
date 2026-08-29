import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Revenue Recovery Agent',
  description: 'Diagnose failed payments, recover revenue within hard limits.',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
