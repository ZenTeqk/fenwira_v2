import type { ReactNode } from 'react'
import { AuthGate } from '@/components/session/auth-gate'

/** The automation workspace owns its viewport; authentication remains shared. */
export default function CanvasLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>
}
