import { type ContactCampaign, listQuerySchema } from '@fenwira/contracts'
import { Controller, Get, Param, Query } from '@nestjs/common'
import { z } from 'zod'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { afterCursor, decodeCursor, toPage } from '../../core/http/cursor'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'

const iso = (d: Date | null) => d?.toISOString() ?? null

/**
 * Contact → Campaigns: the contact's campaign_recipients rows (the authoritative relation; no
 * copy is kept elsewhere), newest first, with each campaign's name and status.
 */
@Controller('contacts')
export class ContactCampaignsController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get(':id/campaigns')
  @RequirePermission('campaigns.read')
  campaigns(
    @Param('id', new ZodValidationPipe(z.uuid())) contactId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    return this.tenantDb.run(async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, deletedAt: null },
        select: { id: true },
      })
      if (!contact) throw AppError.notFound('Contact not found.')
      const rows = await tx.campaignRecipient.findMany({
        where: {
          contactId,
          campaign: { deletedAt: null },
          ...afterCursor(decodeCursor(q.cursor)),
        },
        include: { campaign: { select: { name: true, status: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      })
      const { items, page } = toPage(rows, q.limit)
      const data: ContactCampaign[] = items.map((r) => ({
        campaignId: r.campaignId,
        name: r.campaign.name,
        campaignStatus: r.campaign.status,
        recipientStatus: r.status,
        skipReason: r.skipReason,
        errorCode: r.errorCode,
        sentAt: iso(r.sentAt),
        deliveredAt: iso(r.deliveredAt),
        readAt: iso(r.readAt),
        failedAt: iso(r.failedAt),
        createdAt: r.createdAt.toISOString(),
      }))
      return { data, page }
    })
  }
}
