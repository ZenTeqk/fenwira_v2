'use client'
import type { Campaign } from '@fenwira/contracts'
import { Card, CardContent, EmptyState } from '@fenwira/ui'
import { TemplatePhonePreview } from '@/components/templates/template-phone-preview'
import { useTemplateSampleUrl } from '@/lib/templates'

export function CampaignMessagePreview({ campaign }: { campaign: Campaign }) {
  const template = campaign.template
  const header = template?.components.header
  const sample = useTemplateSampleUrl(
    header && header.format !== 'TEXT' ? header.sampleFileId : null,
  )
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-md font-semibold text-slate">Campaign message</h2>
          <p className="mt-1 break-words text-xs text-secondary">
            {template ? `${template.name} · ${template.language}` : 'No frozen message'}
          </p>
        </div>
        {template ? (
          <>
            <TemplatePhonePreview
              components={template.components}
              samples={{ body: [] }}
              headerImageUrl={sample.data}
              businessName={campaign.phoneNumberDisplay ?? undefined}
              compact
            />
            <p className="text-xs text-secondary">
              The version frozen at launch. Variable markers stay visible here; recipient-specific
              values are in the recipient report.
            </p>
          </>
        ) : (
          <EmptyState
            title="Message not frozen"
            description="A frozen message preview appears after launch."
          />
        )}
      </CardContent>
    </Card>
  )
}
