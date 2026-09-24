import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Gallery } from '@/components/gallery'
import { uiGalleryEnabled } from '@/lib/flags'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Component gallery' }

/** Every @fenwira/ui component and variant (ENABLE_UI_GALLERY=true only). */
export default function GalleryPage() {
  if (!uiGalleryEnabled()) notFound()
  return <Gallery />
}
