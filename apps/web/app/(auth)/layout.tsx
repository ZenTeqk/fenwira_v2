import type { ReactNode } from 'react'
import { BrandMark } from '@/components/shell/brand-mark'

/** The marketing site (fenwira_marketing), where the Log in and Request access buttons live. */
const SITE_URL = 'https://fenwira.com'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <p>
        <a href={SITE_URL} aria-label="Fenwira home">
          <BrandMark variant="lockup" size="lg" />
        </a>
      </p>
      <div className="w-full max-w-md">{children}</div>
      <a href={SITE_URL} className="text-sm text-muted hover:underline">
        ← Back to fenwira.com
      </a>
    </main>
  )
}
