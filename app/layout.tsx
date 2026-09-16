import type { Metadata } from 'next'
import './globals.css'
import { THEME_BOOTSTRAP } from './(ui)/theme-toggle'

export const metadata: Metadata = {
  title: 'Cadre AI — Support Assistant',
  description: 'Answers common questions about Cadre AI, and hands off to a human when it cannot.',
}

// Default export: Next.js layouts permit only their own reserved export names,
// which is the one exception CLAUDE.md carves out of the named-exports rule.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint. Without it the page paints light
            and then switches, and that flash is the only thing users notice
            about theme handling. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
