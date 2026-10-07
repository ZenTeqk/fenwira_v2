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
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary-soft text-primary-strong',
        small ? 'h-9 w-14' : 'h-16 w-24 sm:h-20 sm:w-32',
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
        <Megaphone className={small ? 'size-5' : 'size-8'} />
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
