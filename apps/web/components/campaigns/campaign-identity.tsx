'use client'
import type { Campaign } from '@fenwira/contracts'
import { cn, RowActions } from '@fenwira/ui'
import { Megaphone } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTemplateSampleUrl } from '@/lib/templates'

/** Artwork comes only from the frozen template's existing tenant-scoped image sample. */
export function CampaignArtwork({
  campaign,
  small = false,
}: {
  campaign: Campaign
  small?: boolean
}) {
  const header = campaign.template?.components.header
  const sample = useTemplateSampleUrl(header?.format === 'IMAGE' ? header.sampleFileId : null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted text-fg-secondary',
        small ? 'h-9 w-14' : 'h-14 w-20 sm:h-16 sm:w-24',
      )}
    >
      {sample.data && sample.data !== failedUrl ? (
        // Existing short-lived sample URL; there is no public artwork or decorative campaign image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sample.data}
          alt=""
          className="size-full object-cover"
          onError={() => setFailedUrl(sample.data!)}
        />
      ) : (
        <Megaphone className={small ? 'size-5' : 'size-6'} />
      )}
    </span>
  )
}
export function CampaignActions({ campaign }: { campaign: Campaign }) {
  const router = useRouter()
  return (
    <RowActions
      label={`Actions for ${campaign.name}`}
      actions={[
        { label: 'View campaign', onSelect: () => router.push(`/campaigns/${campaign.id}`) },
      ]}
    />
  )
}
