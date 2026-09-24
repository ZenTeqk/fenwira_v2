import { Database } from '@fenwira/database'
import { GraphClient, GraphError } from '@fenwira/whatsapp'
import { Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../audit'
import {
  credentialStatusFor,
  phoneStatusFromMeta,
  qualityFromMeta,
  readSteps,
} from './connection.mapper'
import { appTokenFor, decryptToken, emitConnectionChanged, THROUGHPUT_MPS } from './graph-support'
import { WHATSAPP_OPTIONS, type WhatsAppOptions } from './whatsapp.options'

export type SyncOutcome = 'synced' | 'skipped' | 'no-credential' | 'credential-invalid'

/**
 * Refreshes one number from Meta: status, quality, tier, throughput, and the credential's
 * validity/expiry (EXPIRING within 7 days, INVALID on 190/permission errors). Used by the
 * whatsapp.sync job (no user) and by POST /whatsapp/connections/:id/sync. Retryable Graph errors
 * are rethrown so BullMQ retries or the API answers 503.
 */
@Injectable()
export class WhatsAppSyncService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WHATSAPP_OPTIONS) private readonly options: WhatsAppOptions,
    private readonly graph: GraphClient,
    private readonly audit: AuditService,
  ) {}

  async syncPhone(tenantId: string, phoneId: string): Promise<SyncOutcome> {
    const phone = await this.db.withTenant(tenantId, (tx) =>
      tx.whatsAppPhoneNumber.findFirst({
        where: { id: phoneId, tenantId },
        include: {
          waba: {
            include: {
              credentials: {
                where: { status: { in: ['VALID', 'EXPIRING'] } },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      }),
    )
    if (!phone || phone.status === 'DISCONNECTED' || phone.status === 'PENDING') return 'skipped'
    const credential = phone.waba.credentials[0]
    const token = decryptToken(this.options, credential?.tokenCiphertext ?? null)
    const now = new Date()
    if (!credential || !token) {
      await this.db.withTenant(tenantId, (tx) =>
        tx.whatsAppPhoneNumber.update({ where: { id: phone.id }, data: { lastSyncedAt: now } }),
      )
      return 'no-credential'
    }

    let details: Awaited<ReturnType<GraphClient['getPhoneNumber']>>
    let tokenInfo: Awaited<ReturnType<GraphClient['debugToken']>>
    try {
      details = await this.graph.getPhoneNumber(token, phone.phoneNumberId)
      tokenInfo = await this.graph.debugToken(token, appTokenFor(this.options, token))
    } catch (err) {
      if (!(err instanceof GraphError) || err.classification !== 'CREDENTIAL') throw err
      await this.db.withTenant(tenantId, async (tx) => {
        await tx.metaCredential.update({
          where: { id: credential.id },
          data: { status: 'INVALID', lastCheckedAt: now },
        })
        await tx.whatsAppPhoneNumber.update({
          where: { id: phone.id },
          data: { lastSyncedAt: now },
        })
        await this.audit.write(tx, {
          tenantId,
          action: 'whatsapp.credential_invalid',
          targetType: 'whatsapp_phone_number',
          targetId: phone.id,
          changes: { reason: err.fenwiraCode },
        })
        await emitConnectionChanged(tx, tenantId, phone.id, 'CREDENTIAL_CHANGED')
      })
      return 'credential-invalid'
    }

    // A connection with a failed setup step stays ERROR until it is retried, whatever Meta says.
    const hasFailedStep = readSteps(phone.statusDetail).some((s) => s.status === 'FAILED')
    const status = hasFailedStep ? phone.status : phoneStatusFromMeta(details.status, phone.status)
    const quality = qualityFromMeta(details.quality_rating)
    const cred = tokenInfo.isValid
      ? credentialStatusFor(tokenInfo.expiresAt)
      : { status: 'INVALID' as const, expiresAt: credential.expiresAt }

    await this.db.withTenant(tenantId, async (tx) => {
      await tx.whatsAppPhoneNumber.update({
        where: { id: phone.id },
        data: {
          status,
          qualityRating: quality,
          messagingLimitTier: details.messaging_limit_tier ?? phone.messagingLimitTier,
          throughputMps: THROUGHPUT_MPS[details.throughput?.level ?? ''] ?? phone.throughputMps,
          displayPhoneNumber: details.display_phone_number || phone.displayPhoneNumber,
          verifiedName: details.verified_name || phone.verifiedName,
          lastSyncedAt: now,
        },
      })
      await tx.metaCredential.update({
        where: { id: credential.id },
        data: { status: cred.status, expiresAt: cred.expiresAt, lastCheckedAt: now },
      })
      const changes: Record<string, unknown> = {}
      if (status !== phone.status) changes.status = [phone.status, status]
      if (quality !== phone.qualityRating) changes.qualityRating = [phone.qualityRating, quality]
      if (cred.status !== credential.status) changes.credential = [credential.status, cred.status]
      if (Object.keys(changes).length > 0) {
        await this.audit.write(tx, {
          tenantId,
          action: 'whatsapp.status_changed',
          targetType: 'whatsapp_phone_number',
          targetId: phone.id,
          changes,
        })
        await emitConnectionChanged(tx, tenantId, phone.id, 'STATUS_CHANGED')
      }
    })
    return 'synced'
  }
}
