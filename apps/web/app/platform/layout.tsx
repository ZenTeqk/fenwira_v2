import { type ReactNode } from 'react'
import { PlatformShell } from '@/components/platform/platform-shell'
export default function Layout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>
}
