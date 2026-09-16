import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cadre AI — Support Assistant',
  description: 'Answers common questions about Cadre AI, and hands off to a human when it cannot.',
}

export function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

export default RootLayout
