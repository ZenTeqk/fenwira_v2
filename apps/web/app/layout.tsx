import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Fenwira',
  description: 'WhatsApp operations platform',
}

// Phase 1 placeholder shell. The design system and application shell arrive in Phase 2.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
