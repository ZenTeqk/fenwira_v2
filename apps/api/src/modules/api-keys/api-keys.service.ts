import {
  API_KEY_SCOPES,
  type ApiKey,
  type ApiKeyScope,
  type CreateApiKeyRequest,
  type CreatedApiKey,
} from '@fenwira/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { generateApiKeyToken, hashApiKeySecret } from './api-key-token'
import { API_KEYS_OPTIONS, type ApiKeysOptions } from './api-keys.options'

const toApiKey = (row: {
  id: string
  name: string
  prefix: string
  scopes: string[]
  createdBy: string | null
  creator: { name: string } | null
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}): ApiKey => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  scopes: row.scopes as ApiKeyScope[],
  createdBy: row.createdBy,
  createdByName: row.creator?.name ?? null,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

/**
 * Tenant API keys (docs/API_KEYS.md, decisions P11-D18, P11-D22). Creation and revocation are
 * `integrations.manage` actions by a signed-in member; the keys themselves authenticate through
 * ApiKeyGuard, a completely separate path.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    @Inject(API_KEYS_OPTIONS) private readonly options: ApiKeysOptions,
  ) {}

  list(): Promise<ApiKey[]> {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.apiKey.findMany({
        include: { creator: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return rows.map(toApiKey)
    })
  }

  /** Scopes are a subset of API_KEY_SCOPES *and* of the creator's own permissions (P11-D18/D22). */
  async create(input: CreateApiKeyRequest): Promise<CreatedApiKey> {
    const { tenantId, permissions } = currentTenant()
    const { userId } = currentAuth()
    const invalid = input.scopes.filter(
      (s) => !(API_KEY_SCOPES as readonly string[]).includes(s) || !permissions.includes(s),
    )
    if (invalid.length)
      throw new AppError(
        'API_KEY_SCOPE_INVALID',
        422,
        'A key can only be granted scopes your own role already has, from the public API surface.',
        { scopes: invalid },
      )
    const { prefix, secret, token } = generateApiKeyToken()
    const keyHash = hashApiKeySecret(this.options.pepper, secret)
    const row = await this.tenantDb.run(async (tx) => {
      const created = await tx.apiKey.create({
        data: {
          tenantId,
          name: input.name,
          prefix,
          keyHash,
          scopes: input.scopes,
          createdBy: userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
        include: { creator: { select: { name: true } } },
      })
      await this.audit.write(tx, {
        action: 'api_key.created',
        targetType: 'api_key',
        targetId: created.id,
        changes: { name: input.name, scopes: input.scopes, prefix },
      })
      return created
    })
    return { key: toApiKey(row), secret: token }
  }

  async revoke(id: string): Promise<void> {
    const { userId } = currentAuth()
    await this.tenantDb.run(async (tx) => {
      const row = await tx.apiKey.findFirst({ where: { id } })
      if (!row) throw AppError.notFound('API key not found.')
      if (row.revokedAt) return
      await tx.apiKey.update({
        where: { id },
        data: { revokedAt: new Date(), revokedBy: userId },
      })
      await this.audit.write(tx, {
        action: 'api_key.revoked',
        targetType: 'api_key',
        targetId: id,
        changes: { name: row.name, prefix: row.prefix },
      })
    })
  }
}
