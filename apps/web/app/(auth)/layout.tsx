import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <p className="text-xl font-semibold text-slate">
        Fenwira<span className="text-primary-strong">.</span>
      </p>
      <div className="w-full max-w-md">{children}</div>
    </main>
  )
}
