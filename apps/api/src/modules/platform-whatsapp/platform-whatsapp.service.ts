import {
  type ManagedConnectRequest,
  type ManagedRotateRequest,
  type PlatformWhatsAppConnection,
  type TemplateSyncSummary,
  type VerifyConnectionResult,
  type MetaHealth,
} from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { AuditService } from '../audit'
import { TemplateSyncService } from '../templates'
import { WhatsAppConnectionService } from '../whatsapp-accounts'

/**
 * ADR-0027 operator console for a workspace's Meta connection. Each call selects the workspace for
 * the rest of the request (so the connection service, RLS and audit all run as that tenant, with
 * the operator as actor) and records a platform audit row: who, which workspace, what, outcome.
 * Secrets never reach a response, log line or audit entry.
 */
@Injectable()
export class PlatformWhatsAppService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly tenantDb: TenantDb,
    private readonly connections: WhatsAppConnectionService,
    private readonly templates: TemplateSyncService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  list(workspaceId: string): Promise<PlatformWhatsAppConnection[]> {
    return this.act(workspaceId, null, () => this.connections.listPlatform())
  }

  get(workspaceId: string, id: string): Promise<PlatformWhatsAppConnection> {
    return this.act(workspaceId, null, () => this.connections.getPlatform(id))
  }

  connect(workspaceId: string, input: ManagedConnectRequest): Promise<PlatformWhatsAppConnection> {
    return this.act(workspaceId, 'whatsapp.managed_connect', async () => {
      const c = await this.connections.managedConnect(input)
      return this.connections.getPlatform(c.id)
    })
  }

  /** Read-only: Meta's live messaging health for the number (no audit row). */
  health(workspaceId: string, id: string): Promise<MetaHealth> {
    return this.act(workspaceId, null, () => this.connections.healthStatus(id))
  }

  verify(workspaceId: string, id: string): Promise<VerifyConnectionResult> {
    return this.act(workspaceId, 'whatsapp.verify', () => this.connections.verifyConnection(id))
  }

  subscribe(workspaceId: string, id: string): Promise<PlatformWhatsAppConnection> {
    return this.act(workspaceId, 'whatsapp.subscribe', async () => {
      await this.connections.subscribeWebhooks(id)
      return this.connections.getPlatform(id)
    })
  }

  syncPhone(workspaceId: string, id: string): Promise<PlatformWhatsAppConnection> {
    return this.act(workspaceId, 'whatsapp.sync_phone', async () => {
      await this.connections.syncAudited(id)
      return this.connections.getPlatform(id)
    })
  }

  syncTemplates(workspaceId: string, id: string): Promise<TemplateSyncSummary> {
    return this.act(workspaceId, 'whatsapp.sync_templates', async () => {
      await this.limits.consume([
        { bucket: 'templates-sync:tenant', key: workspaceId, limit: 30, windowSeconds: 3600 },
      ])
      const phone = await this.tenantDb.run((tx) =>
        tx.whatsAppPhoneNumber.findFirst({
          where: { id, status: { not: 'DISCONNECTED' } },
          select: { wabaId: true },
        }),
      )
      if (!phone) throw AppError.notFound('WhatsApp connection not found.')
      const result = await this.templates.syncWaba(workspaceId, phone.wabaId)
      if (!result)
        throw new AppError('CONFLICT', 409, 'This connection has no valid token. Rotate it first.')
      const summary = {
        syncedAt: new Date().toISOString(),
        imported: result.imported,
        updated: result.updated,
        missing: result.missing,
      }
      await this.tenantDb.run((tx) =>
        this.audit.write(tx, {
          action: 'templates.synced',
          targetType: 'whatsapp_phone_number',
          targetId: id,
          changes: {
            imported: summary.imported,
            updated: summary.updated,
            missing: summary.missing,
          },
        }),
      )
      return summary
    })
  }

  rotate(
    workspaceId: string,
    id: string,
    input: ManagedRotateRequest,
  ): Promise<PlatformWhatsAppConnection> {
    return this.act(workspaceId, 'whatsapp.rotate', async () => {
      await this.connections.rotateManaged(id, input)
      return this.connections.getPlatform(id)
    })
  }

  disconnect(workspaceId: string, id: string): Promise<void> {
    return this.act(workspaceId, 'whatsapp.disconnect', () => this.connections.disconnect(id))
  }

  /**
   * Selects the workspace (404 when it doesn't exist or is deleted, same as a foreign one) and,
   * for mutations, writes the platform audit row whatever the outcome.
   */
  private async act<T>(workspaceId: string, action: string | null, fn: () => Promise<T>) {
    const operatorId = requestContext.get()?.platform?.operatorId
    if (!operatorId) throw new AppError('FORBIDDEN', 403, 'Operator session required.')
    const found = await this.db.system.platformWorkspaces(operatorId, workspaceId, 1)
    if (!found.some((w) => w.id === workspaceId))
      throw new AppError('TENANT_NOT_FOUND', 404, 'Workspace not found.')
    requestContext.patch({
      tenantId: workspaceId,
      tenant: { tenantId: workspaceId, membershipId: `platform:${operatorId}`, permissions: [] },
    })
    if (!action) return fn()
    let outcome = 'FAILED'
    try {
      const result = await fn()
      outcome = 'SUCCESS'
      return result
    } finally {
      // createMany: platform_audit's read policy forbids the RETURNING a single create needs.
      await this.db.withTenant(workspaceId, (tx) =>
        tx.platformAudit.createMany({
          data: {
            operatorId,
            workspaceId,
            action: `platform.${action}`,
            outcome,
            correlationId: requestContext.correlationId() ?? null,
          },
        }),
      )
    }
  }
}
