import { createHash } from 'node:crypto'
import { decryptSecret, encryptSecret, randomToken, sha256, uuidv7 } from '@fenwira/config'
import {
  nativeProviderSchema,
  ROLE_PERMISSIONS,
  type NativeSetup,
  type NativeCallback,
  type NativeTransferRequest,
  type NativeConnection,
  type NativeTransfer,
} from '@fenwira/contracts'
import { Database, Prisma, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { requestContext } from '../../core/context/request-context'
import { StorageService } from '../../core/storage/storage.service'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { ImportsService } from '../contacts'
import { NATIVE_OPTIONS, type NativeOptions } from './native.options'
import {
  NativeProviders,
  NativeProviderError,
  type NativeSecrets,
  type NativePerson,
} from './native.providers'

const publicConnection = (r: Prisma.NativeConnectionGetPayload<object>): NativeConnection => ({
  id: r.id,
  provider: nativeProviderSchema.parse(r.provider),
  label: r.label,
  site: r.site,
  status: r.status as NativeConnection['status'],
  createdAt: r.createdAt.toISOString(),
})
const publicTransfer = (r: Prisma.NativeTransferGetPayload<object>): NativeTransfer => ({
  id: r.id,
  connectionId: r.connectionId,
  status: r.status as NativeTransfer['status'],
  rows: r.rows,
  importJobId: r.importJobId,
  errorCode: r.errorCode,
  createdAt: r.createdAt.toISOString(),
})
const errorCode = (e: unknown) =>
  e instanceof NativeProviderError ? e.code : 'CONNECTOR_OPERATION_FAILED'
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`

@Injectable()
export class NativeService {
  readonly providers: NativeProviders
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(Database) private readonly db: Database,
    @Inject(NATIVE_OPTIONS) private readonly options: NativeOptions,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly imports: ImportsService,
  ) {
    this.providers = new NativeProviders(
      options.apps,
      `${options.webOrigin}/integrations/native/callback`,
    )
  }
  private cipher(value: unknown): Uint8Array<ArrayBuffer> {
    return encryptSecret(this.options.keyRing, JSON.stringify(value))
  }
  private decode<T>(value: Uint8Array): T {
    return JSON.parse(decryptSecret(this.options.keyRing, value)) as T
  }
  private async find(tx: TenantTx, id: string) {
    const row = await tx.nativeConnection.findFirst({ where: { id } })
    if (!row) throw AppError.notFound()
    return row
  }
  async list() {
    const rows = await this.tenantDb.run((tx) =>
      tx.nativeConnection.findMany({ orderBy: { createdAt: 'desc' } }),
    )
    return nativeProviderSchema.options.map((provider) => ({
      provider,
      available: provider === 'ERPNEXT' || !!this.options.apps[provider],
      connections: rows.filter((r) => r.provider === provider).map(publicConnection),
    }))
  }
  async begin(input: NativeSetup) {
    let site: string | null
    try {
      site = this.providers.site(input)
    } catch {
      throw AppError.validation([
        {
          path: 'site',
          code: 'invalid',
          message: 'Use a public HTTPS ERPNext root URL or your myshopify.com store domain.',
        },
      ])
    }
    if (input.provider === 'ERPNEXT') {
      if (!input.apiKey || !input.apiSecret)
        throw AppError.validation([
          { path: 'apiKey', code: 'required', message: 'Enter the API key and secret.' },
        ])
      const secrets = { apiKey: input.apiKey, apiSecret: input.apiSecret }
      try {
        await this.providers.verifyErp(site!, secrets)
      } catch (e) {
        throw new AppError('VALIDATION_FAILED', 422, 'ERPNext connection verification failed.', {
          code: errorCode(e),
        })
      }
      const connection = await this.save(input, site, secrets)
      return { connection }
    }
    // Credentials supplied for an OAuth provider are rejected, never retained.
    if (input.apiKey || input.apiSecret)
      throw AppError.validation([
        {
          path: 'provider',
          code: 'oauth_required',
          message: 'Use OAuth to connect this application.',
        },
      ])
    const state = randomToken()
    const verifier = randomToken(48)
    let authorizationUrl: string
    try {
      authorizationUrl = this.providers.authorize(input, state, verifier)
    } catch {
      throw new AppError('VALIDATION_FAILED', 422, 'This provider app has not been configured yet.')
    }
    const { userId, sessionId } = currentAuth()
    const { tenantId } = currentTenant()
    await this.tenantDb.run(async (tx) => {
      await tx.nativeOauthChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } })
      await tx.nativeOauthChallenge.create({
        data: {
          tenantId,
          stateHash: Buffer.from(sha256(state)),
          userId,
          sessionId,
          provider: input.provider,
          label: input.label,
          site,
          region: input.region,
          verifierCiphertext: Buffer.from(encryptSecret(this.options.keyRing, verifier)),
          expiresAt: new Date(Date.now() + 600_000),
        },
      })
      await this.audit.write(tx, {
        action: 'native.authorization_started',
        targetType: 'native_connector',
        changes: { provider: input.provider },
      })
    })
    return { authorizationUrl, state }
  }
  private save(input: NativeSetup, site: string | null, secrets: NativeSecrets) {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const row = await tx.nativeConnection.create({
        data: {
          tenantId,
          provider: input.provider,
          label: input.label,
          site,
          region: input.region,
          secretCiphertext: this.cipher(secrets),
        },
      })
      await this.audit.write(tx, {
        action: 'native.connected',
        targetType: 'native_connection',
        targetId: row.id,
        changes: { provider: input.provider },
      })
      return publicConnection(row)
    })
  }
  async complete(body: NativeCallback) {
    const { userId, sessionId } = currentAuth()
    const challenge = await this.tenantDb.run(async (tx) => {
      const row = await tx.nativeOauthChallenge.findFirst({
        where: {
          stateHash: Buffer.from(sha256(body.state)),
          userId,
          sessionId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
      })
      if (!row)
        throw new AppError(
          'VALIDATION_FAILED',
          422,
          'Authorization expired or belongs to another workspace/session. Start again.',
        )
      const consumed = await tx.nativeOauthChallenge.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: new Date() },
      })
      if (consumed.count !== 1)
        throw new AppError('VALIDATION_FAILED', 422, 'Authorization was already used.')
      return row
    })
    const input: NativeSetup = {
      provider: nativeProviderSchema.parse(challenge.provider),
      label: challenge.label,
      site: challenge.site ?? undefined,
      region: challenge.region as NativeSetup['region'],
    }
    try {
      const secrets = await this.providers.exchange(
        input,
        body,
        decryptSecret(this.options.keyRing, challenge.verifierCiphertext),
      )
      return await this.save(input, challenge.site, secrets)
    } catch (e) {
      await this.tenantDb.run((tx) =>
        this.audit.write(tx, {
          action: 'native.authorization_failed',
          targetType: 'native_connector',
          changes: { provider: input.provider, failureKind: errorCode(e) },
        }),
      )
      throw new AppError('VALIDATION_FAILED', 422, 'Provider authorization failed. Start again.', {
        code: errorCode(e),
      })
    } finally {
      await this.tenantDb.run((tx) =>
        tx.nativeOauthChallenge.deleteMany({ where: { id: challenge.id } }),
      )
    }
  }
  async disconnect(id: string) {
    await this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      await tx.nativeConnection.update({
        where: { id },
        data: { status: 'DISCONNECTED', secretCiphertext: null, revision: { increment: 1 } },
      })
      await this.audit.write(tx, {
        action: 'native.disconnected',
        targetType: 'native_connection',
        targetId: id,
      })
    })
  }
  async transfers(id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      return (
        await tx.nativeTransfer.findMany({
          where: { connectionId: id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      ).map(publicTransfer)
    })
  }
  async start(id: string, input: NativeTransferRequest) {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM native_connections WHERE id=${id}::uuid FOR UPDATE`
      const connection = await this.find(tx, id)
      if (connection.status !== 'ACTIVE')
        throw new AppError('VALIDATION_FAILED', 409, 'Reconnect this application first.')
      const exporting = connection.provider === 'GOOGLE_SHEETS'
      const permission = exporting ? 'contacts.export' : 'contacts.import'
      if (!currentTenant().permissions.includes(permission))
        throw new AppError(
          'FORBIDDEN',
          403,
          'You do not have permission for this contact transfer.',
        )
      if (exporting && (!input.spreadsheetId || input.confirmExport !== true))
        throw AppError.validation([
          {
            path: 'spreadsheetId',
            code: 'required',
            message: 'Choose a spreadsheet and confirm the contact export.',
          },
        ])
      if (!exporting && (input.spreadsheetId || input.confirmExport))
        throw AppError.validation([
          { path: 'provider', code: 'invalid', message: 'This connector imports contacts.' },
        ])
      const hash = createHash('sha256')
        .update(JSON.stringify({ id, spreadsheetId: input.spreadsheetId ?? null }))
        .digest('hex')
      const existing = await tx.nativeTransfer.findFirst({
        where: { idempotencyKey: input.idempotencyKey },
      })
      if (existing) {
        if (existing.requestHash !== hash)
          throw new AppError(
            'VALIDATION_FAILED',
            409,
            'This idempotency key belongs to another request.',
          )
        return publicTransfer(existing)
      }
      // One pending transfer per connection also serializes credential refresh.
      const active = await tx.nativeTransfer.findFirst({
        where: { connectionId: id, status: 'PENDING' },
      })
      if (active)
        throw new AppError(
          'VALIDATION_FAILED',
          409,
          'A transfer is already pending. Inspect or retry that transfer first.',
        )
      const row = await tx.nativeTransfer.create({
        data: {
          tenantId,
          connectionId: id,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          actorId: userId,
          request: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
        },
      })
      await this.event(tx, tenantId, row.id)
      await this.audit.write(tx, {
        action: 'native.transfer_requested',
        targetType: 'native_transfer',
        targetId: row.id,
        changes: { provider: connection.provider, direction: exporting ? 'EXPORT' : 'IMPORT' },
      })
      return publicTransfer(row)
    })
  }
  private event(tx: TenantTx, tenantId: string, transferId: string) {
    return tx.outboxEvent.create({
      data: {
        tenantId,
        eventType: 'native.transfer_requested',
        aggregateType: 'native_transfer',
        aggregateId: transferId,
        payload: { transferId },
        correlationId: requestContext.correlationId(),
      },
    })
  }
  async retry(id: string, transferId: string) {
    return this.tenantDb.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM native_connections WHERE id=${id}::uuid FOR UPDATE`
      const connection = await this.find(tx, id)
      const row = await tx.nativeTransfer.findFirst({ where: { id: transferId, connectionId: id } })
      if (!row) throw AppError.notFound()
      const permission =
        connection.provider === 'GOOGLE_SHEETS' ? 'contacts.export' : 'contacts.import'
      if (!currentTenant().permissions.includes(permission))
        throw new AppError('FORBIDDEN', 403, 'Contact transfer permission is required.')
      if (
        connection.status !== 'ACTIVE' ||
        row.status === 'SUCCEEDED' ||
        (row.leaseUntil && row.leaseUntil > new Date())
      )
        throw new AppError('VALIDATION_FAILED', 409, 'This transfer cannot be retried now.')
      const competing = await tx.nativeTransfer.findFirst({
        where: { connectionId: id, status: 'PENDING', id: { not: transferId } },
      })
      if (competing)
        throw new AppError('VALIDATION_FAILED', 409, 'Another transfer is already pending.')
      const retried = await tx.nativeTransfer.update({
        where: { id: transferId },
        data: {
          status: 'PENDING',
          errorCode: null,
          leaseUntil: null,
          leaseToken: null,
          actorId: currentAuth().userId,
        },
      })
      await this.event(tx, currentTenant().tenantId, transferId)
      await this.audit.write(tx, {
        action: 'native.transfer_retried',
        targetType: 'native_transfer',
        targetId: transferId,
      })
      return publicTransfer(retried)
    })
  }

  /** Worker entry: tenant comes from the outbox, actual membership is rechecked; no HTTP-role impersonation. */
  async process(tenantId: string, transferId: string): Promise<string> {
    const lease = uuidv7()
    const claimed = await this.db
      .withTenant(tenantId, async (tx) => {
        const updated = await tx.nativeTransfer.updateMany({
          where: {
            id: transferId,
            status: 'PENDING',
            OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
          },
          data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) },
        })
        if (!updated.count) return null
        const transfer = await tx.nativeTransfer.findFirstOrThrow({ where: { id: transferId } })
        const connection = await this.find(tx, transfer.connectionId)
        const membership = await tx.membership.findFirst({
          where: { tenantId, userId: transfer.actorId, status: 'ACTIVE' },
          include: { tenant: true, user: true },
        })
        const permission =
          connection.provider === 'GOOGLE_SHEETS' ? 'contacts.export' : 'contacts.import'
        if (
          !membership ||
          membership.tenant.deletedAt ||
          membership.user.disabledAt ||
          !ROLE_PERMISSIONS[membership.role].includes('integrations.manage') ||
          !ROLE_PERMISSIONS[membership.role].includes(permission) ||
          connection.status !== 'ACTIVE' ||
          !connection.secretCiphertext
        )
          return { transfer, connection, authorized: false }
        if (
          membership.tenant.require2fa &&
          !(await tx.twoFactorCredential.findUnique({ where: { userId: membership.userId } }))
            ?.enabledAt
        )
          return { transfer, connection, authorized: false }
        return { transfer, connection, authorized: true }
      })
      .catch(async (e) => {
        await this.fail(tenantId, transferId, lease, errorCode(e))
        return null
      })
    if (!claimed) return 'not-claimed'
    if (!claimed.authorized) {
      await this.fail(tenantId, transferId, lease, 'TRANSFER_AUTHORIZATION_LOST')
      return 'denied'
    }
    const { transfer, connection } = claimed
    const beat = setInterval(() => {
      void this.db
        .withTenant(tenantId, (tx) =>
          tx.nativeTransfer.updateMany({
            where: { id: transferId, leaseToken: lease, status: 'PENDING' },
            data: { leaseUntil: new Date(Date.now() + 120_000) },
          }),
        )
        .catch(() => undefined)
    }, 30_000)
    try {
      const provider = nativeProviderSchema.parse(connection.provider)
      const secrets = await this.providers.refresh(
        provider,
        connection.site,
        connection.region,
        this.decode<NativeSecrets>(connection.secretCiphertext!),
      )
      const saved = await this.db.withTenant(tenantId, (tx) =>
        tx.nativeConnection.updateMany({
          where: { id: connection.id, status: 'ACTIVE', revision: connection.revision },
          data: { secretCiphertext: this.cipher(secrets), revision: { increment: 1 } },
        }),
      )
      if (!saved.count) throw new NativeProviderError('CONNECTION_CHANGED')
      let snapshot = transfer.snapshotCiphertext
        ? this.decode<string[][]>(transfer.snapshotCiphertext)
        : null
      if (!snapshot) {
        if (provider === 'GOOGLE_SHEETS') {
          snapshot = await this.db.withTenant(tenantId, async (tx) => {
            const contacts = await tx.contact.findMany({
              where: { deletedAt: null, status: 'ACTIVE' },
              orderBy: { id: 'asc' },
              take: 10001,
              select: { id: true, phoneE164: true, name: true, email: true },
            })
            if (contacts.length > 10000) throw new NativeProviderError('EXPORT_LIMIT_EXCEEDED')
            return [
              ['Fenwira contact ID', 'Phone', 'Name', 'Email'],
              ...contacts.map((c) => [c.id, c.phoneE164, c.name ?? '', c.email ?? '']),
            ]
          })
        } else {
          const people: NativePerson[] = await this.providers.people(
            provider,
            connection.site,
            connection.region,
            secrets,
          )
          snapshot = [['Phone', 'Name', 'Email'], ...people.map((p) => [p.phone, p.name, p.email])]
        }
        const payload = snapshot
        const storedSnapshot = await this.db.withTenant(tenantId, (tx) =>
          tx.nativeTransfer.updateMany({
            where: { id: transferId, leaseToken: lease, status: 'PENDING' },
            data: { snapshotCiphertext: this.cipher(payload), rows: payload.length - 1 },
          }),
        )
        if (!storedSnapshot.count) throw new NativeProviderError('TRANSFER_LEASE_LOST')
      }
      await this.db.withTenant(tenantId, (tx) =>
        this.assertActive(tx, connection.id, transferId, lease),
      )
      if (provider === 'GOOGLE_SHEETS') {
        const input = transfer.request as NativeTransferRequest
        // The exact tab belongs to this receipt. RAW values cannot become spreadsheet formulas.
        await this.providers.exportSheet(secrets, input.spreadsheetId!, [
          [`Fenwira Contacts ${transfer.id}`],
          ...snapshot,
        ])
        await this.finish(tenantId, transferId, lease, null)
      } else {
        if (snapshot.length <= 1) throw new NativeProviderError('NO_CONTACTS_FOUND')
        const bytes = Buffer.from(snapshot.map((r) => r.map(csvCell).join(',')).join('\r\n'))
        const key = `${tenantId}/imports/${transferId}`
        await this.storage.put(this.storage.importsBucket, key, bytes, 'text/csv')
        await this.db.withTenant(tenantId, async (tx) => {
          await this.assertActive(tx, connection.id, transferId, lease)
          await this.imports.prepareNative(tx, {
            tenantId,
            id: transferId,
            objectKey: key,
            sizeBytes: bytes.length,
            filename: `${provider.toLowerCase()}-contacts-${transferId.slice(0, 8)}.csv`,
            actorId: transfer.actorId,
          })
          await this.markFinished(tx, tenantId, transferId, lease, transferId)
        })
      }
      return 'completed'
    } catch (e) {
      await this.fail(tenantId, transferId, lease, errorCode(e))
      return 'failed'
    } finally {
      clearInterval(beat)
    }
  }
  private async assertActive(
    tx: TenantTx,
    connectionId: string,
    transferId: string,
    lease: string,
  ) {
    await tx.$queryRaw`SELECT id FROM native_connections WHERE id=${connectionId}::uuid FOR UPDATE`
    const connection = await this.find(tx, connectionId)
    const transfer = await tx.nativeTransfer.findFirst({
      where: { id: transferId, leaseToken: lease, status: 'PENDING' },
    })
    if (connection.status !== 'ACTIVE' || !transfer)
      throw new NativeProviderError('CONNECTION_CHANGED')
  }
  private async markFinished(
    tx: TenantTx,
    tenantId: string,
    id: string,
    lease: string,
    importJobId: string | null,
  ) {
    const updated = await tx.nativeTransfer.updateMany({
      where: { id, leaseToken: lease, status: 'PENDING' },
      data: { status: 'SUCCEEDED', importJobId, leaseUntil: null, leaseToken: null },
    })
    if (!updated.count) throw new NativeProviderError('TRANSFER_LEASE_LOST')
    await this.audit.write(tx, {
      tenantId,
      actorId: null,
      action: 'native.transfer_completed',
      targetType: 'native_transfer',
      targetId: id,
      changes: { importJobId },
    })
  }
  private finish(tenantId: string, id: string, lease: string, importJobId: string | null) {
    return this.db.withTenant(tenantId, async (tx) => {
      const row = await tx.nativeTransfer.findFirstOrThrow({ where: { id } })
      await this.assertActive(tx, row.connectionId, id, lease)
      await this.markFinished(tx, tenantId, id, lease, importJobId)
    })
  }
  private fail(tenantId: string, id: string, lease: string, code: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const updated = await tx.nativeTransfer.updateMany({
        where: { id, leaseToken: lease, status: 'PENDING' },
        data: { status: 'FAILED', errorCode: code, leaseUntil: null, leaseToken: null },
      })
      if (updated.count)
        await this.audit.write(tx, {
          tenantId,
          actorId: null,
          action: 'native.transfer_failed',
          targetType: 'native_transfer',
          targetId: id,
          changes: { failureKind: code },
        })
    })
  }
}
