import type { ReactNode } from 'react'
import { BrandMark } from '@/components/shell/brand-mark'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <p>
        <BrandMark size="lg" />
      </p>
      <div className="w-full max-w-md">{children}</div>
    </main>
  )
}
