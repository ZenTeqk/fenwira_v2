import { cn } from '@fenwira/ui'
import Image from 'next/image'

/**
 * Official third-party marks for integrations Fenwira actually supports (docs/brand/README.md →
 * Third-party logos). Shown unmodified, on a white tile, beside the integration name; they never
 * add UI colours and are never used for unsupported integrations.
 */
const LOGOS = {
  WHATSAPP: { src: '/integrations/whatsapp.svg', name: 'WhatsApp', wide: false },
  ERPNEXT: { src: '/integrations/erpnext.svg', name: 'ERPNext', wide: false },
  GOOGLE_SHEETS: { src: '/integrations/google-sheets.png', name: 'Google Sheets', wide: false },
  ZOHO_CRM: { src: '/integrations/zoho.png', name: 'Zoho', wide: true },
  SHOPIFY: { src: '/integrations/shopify.svg', name: 'Shopify', wide: false },
} as const

export type IntegrationLogoKey = keyof typeof LOGOS

/** `decorative` when the integration's name is already written next to the logo. */
export function IntegrationLogo({
  integration,
  size = 'md',
  decorative = true,
  className,
}: {
  integration: IntegrationLogoKey
  size?: 'sm' | 'md' | 'lg'
  decorative?: boolean
  className?: string
}) {
  const logo = LOGOS[integration]
  const px = { sm: 20, md: 32, lg: 44 }[size]
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md border border-border bg-surface',
        size === 'sm' ? 'size-7 p-1' : size === 'md' ? 'size-10 p-1.5' : 'size-14 p-2',
        className,
      )}
    >
      <Image
        src={logo.src}
        alt={decorative ? '' : logo.name}
        width={px}
        height={logo.wide ? Math.round(px * 0.43) : px}
        className="h-auto max-h-full w-full object-contain"
        unoptimized
      />
    </span>
  )
}
