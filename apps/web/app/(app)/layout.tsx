import type { ReactNode } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { uiGalleryEnabled } from '@/lib/flags'
import { navPreviewEnabled } from '@/lib/navigation'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell navPreview={navPreviewEnabled()} galleryEnabled={uiGalleryEnabled()}>
      {children}
    </AppShell>
  )
}
