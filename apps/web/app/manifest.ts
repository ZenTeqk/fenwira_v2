import { colorTokens } from '@fenwira/ui'
import type { MetadataRoute } from 'next'

/** Web app manifest: install name and icons (docs/brand/README.md). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fenwira',
    short_name: 'Fenwira',
    description: 'WhatsApp operations platform by ZenteqK',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: colorTokens.background,
    theme_color: colorTokens.slate,
    icons: [
      { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
