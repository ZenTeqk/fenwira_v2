import type { ReactNode } from 'react'
import { AuthGate } from '@/components/session/auth-gate'
import { AppShell } from '@/components/shell/app-shell'
import { uiGalleryEnabled } from '@/lib/flags'
import { navPreviewEnabled } from '@/lib/navigation'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell navPreview={navPreviewEnabled()} galleryEnabled={uiGalleryEnabled()}>
        {children}
      </AppShell>
    </AuthGate>
  )
}
