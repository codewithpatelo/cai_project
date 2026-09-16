import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cadre AI — Support Assistant',
  description: 'Answers common questions about Cadre AI, and hands off to a human when it cannot.',
}

// Default export: Next.js layouts permit only their own reserved export names,
// which is the one exception CLAUDE.md carves out of the named-exports rule.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
