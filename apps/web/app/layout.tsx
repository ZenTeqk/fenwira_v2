import { colorTokens } from '@fenwira/ui'
import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import type { ReactNode } from 'react'
import { Providers } from '@/components/providers'
import { serverEnv } from '@/lib/env'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

/**
 * Favicons follow the browser's colour scheme (light/dark variants; app/favicon.ico for legacy
 * requests); link previews come from app/opengraph-image.png and twitter-image.png. Sources and
 * usage: docs/brand/README.md.
 */
export const metadata: Metadata = {
  metadataBase: new URL(serverEnv.WEB_ORIGIN),
  title: { default: 'Fenwira', template: '%s · Fenwira' },
  description: 'WhatsApp operations platform by ZenteqK',
  applicationName: 'Fenwira',
  openGraph: { siteName: 'Fenwira', title: 'Fenwira by ZenteqK', type: 'website' },
  twitter: { card: 'summary_large_image', title: 'Fenwira by ZenteqK' },
  icons: {
    icon: [
      {
        url: '/brand/favicon-light.png',
        type: 'image/png',
        sizes: '64x64',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/brand/favicon-dark.png',
        type: 'image/png',
        sizes: '64x64',
        media: '(prefers-color-scheme: dark)',
      },
    ],
    apple: [{ url: '/brand/apple-icon.png', sizes: '180x180' }],
  },
}

export const viewport: Viewport = { themeColor: colorTokens.slate }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
