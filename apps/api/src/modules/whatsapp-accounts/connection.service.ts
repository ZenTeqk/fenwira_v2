import { encryptSecret } from '@fenwira/config'
import {
  type ConnectionStep,
  type ConnectionStepKey,
  type ConnectWhatsAppRequest,
  type DevConnectWhatsAppRequest,
  type RotateTokenRequest,
  type TestConnectionResult,
  type UpdateConnectionRequest,
  type WhatsAppConnection,
  type WhatsAppSignupConfig,
} from '@fenwira/contracts'
import { Database, type TenantTx } from '@fenwira/database'
import {
  GraphClient,
  GraphError,
  type PhoneNumberDetails,
  type WabaDetails,
} from '@fenwira/whatsapp'
import { Inject, Injectable } from '@nestjs/common'
import { randomInt } from 'node:crypto'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { AuditService } from '../audit'
import { currentTenant } from '../tenancy'
import {
  CONNECTION_INCLUDE,
  credentialStatusFor,
  freshSteps,
  phoneStatusFromMeta,
  qualityFromMeta,
  readSteps,
  setStep,
  tokenParts,
  toConnection,
} from './connection.mapper'
import {
  decryptToken,
  emitConnectionChanged,
  StepFailure,
  stepError,
  SUBSCRIBED_FIELDS,
  THROUGHPUT_MPS,
  verifyToken,
} from './graph-support'
import { type SyncOutcome, WhatsAppSyncService } from './sync.service'
import { WHATSAPP_OPTIONS, type WhatsAppOptions } from './whatsapp.options'

type TokenType = 'BUSINESS_INTEGRATION' | 'DEV'
const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
const alreadyConnected = () =>
  new AppError(
    'PHONE_NUMBER_ALREADY_CONNECTED',
    409,
    'This number is already connected to another Fenwira workspace. Disconnect it there first.',
  )
const LIVE = { not: 'DISCONNECTED' } as const

/**
 * Connect, manage and disconnect WhatsApp numbers (docs/META_INTEGRATION.md → Embedded Signup).
 * Graph calls never run inside a database transaction. The token is decrypted only right before
 * a Graph call and never leaves this module: responses carry `maskedToken`, audit entries none.
 */
@Injectable()
export class WhatsAppConnectionService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WHATSAPP_OPTIONS) private readonly options: WhatsAppOptions,
    private readonly tenantDb: TenantDb,
    private readonly graph: GraphClient,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly syncService: WhatsAppSyncService,
  ) {}

  signupConfig(): WhatsAppSignupConfig {
    const { appId, appSecret, configId, graphVersion, devConnect } = this.options
    return {
      embeddedSignup: Boolean(appId && appSecret && configId),
      appId: appId ?? null,
      configId: configId ?? null,
      graphVersion,
      devConnect,
    }
  }

  async list(): Promise<WhatsAppConnection[]> {
    const rows = await this.tenantDb.run((tx) =>
      tx.whatsAppPhoneNumber.findMany({
        where: { status: LIVE },
        include: CONNECTION_INCLUDE,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    )
    return rows.map(toConnection)
  }

  async get(id: string): Promise<WhatsAppConnection> {
    return toConnection(await this.tenantDb.run((tx) => this.findLive(tx, id)))
  }

  // ------------------------------------------------------------------------------------------
  // Connect: steps 1–5 run before anything is stored (a failure there means starting over with a
  // fresh Embedded Signup code); steps 6–8 are persisted on the number and resumable via retry.
  // ------------------------------------------------------------------------------------------

  connect(input: ConnectWhatsAppRequest): Promise<WhatsAppConnection> {
    const { appId, appSecret } = this.options
    if (!appId || !appSecret)
      throw new AppError('UNPROCESSABLE', 422, 'Embedded Signup is not configured on this server.')
    return this.runConnect(input.wabaId, input.phoneNumberId, 'BUSINESS_INTEGRATION', () =>
      this.graph.exchangeCode(appId, appSecret, input.code),
    )
  }

  devConnect(input: DevConnectWhatsAppRequest): Promise<WhatsAppConnection> {
    if (!this.options.devConnect) throw AppError.notFound()
    return this.runConnect(input.wabaId, input.phoneNumberId, 'DEV', null, input.accessToken)
  }

  private async runConnect(
    wabaId: string,
    phoneNumberId: string,
    tokenType: TokenType,
    exchange: (() => Promise<string>) | null,
    pastedToken?: string,
  ): Promise<WhatsAppConnection> {
    const { tenantId } = currentTenant()
    await this.limits.consume([
      { bucket: 'whatsapp-connect:tenant', key: tenantId, limit: 20, windowSeconds: 3600 },
    ])
    let steps = freshSteps()
    const step = async <T>(key: ConnectionStepKey, fn: () => Promise<T>): Promise<T> => {
      try {
        const result = await fn()
        steps = setStep(steps, key, 'DONE')
        return result
      } catch (err) {
        const error = stepError(err)
        if (!error) throw err
        steps = setStep(steps, key, 'FAILED', error)
        throw new AppError('WHATSAPP_CONNECT_FAILED', 422, error.message, { step: key, steps })
      }
    }

    let token: string
    if (exchange) token = await step('EXCHANGE', exchange)
    else {
      token = pastedToken!
      steps = setStep(steps, 'EXCHANGE', 'SKIPPED')
    }
    const info = await step('VERIFY', () => verifyToken(this.graph, this.options, token, wabaId))
    const { waba, phone } = await step('FETCH', async () => {
      const waba = await this.graph.getWaba(token, wabaId)
      const phone = (await this.graph.listPhoneNumbers(token, wabaId)).find(
        (p) => p.id === phoneNumberId,
      )
      if (!phone)
        throw new StepFailure(
          'META_PHONE_NOT_IN_WABA',
          'That phone number is not part of this WhatsApp Business Account.',
        )
      return { waba, phone }
    })
    if (await this.db.system.phoneNumberOwnerExists(phoneNumberId, tenantId))
      throw alreadyConnected()
    steps = setStep(steps, 'UNIQUE', 'DONE')
    steps = setStep(steps, 'STORE', 'DONE')

    const cred = credentialStatusFor(info.expiresAt)
    const phoneId = await this.store({
      tenantId,
      waba,
      phone,
      token,
      tokenType,
      scopes: info.scopes,
      credential: cred,
      steps,
    })
    return this.runRemaining(phoneId)
  }

  private async store(input: {
    tenantId: string
    waba: WabaDetails
    phone: PhoneNumberDetails
    token: string
    tokenType: TokenType
    scopes: string[]
    credential: { status: 'VALID' | 'EXPIRING'; expiresAt: Date | null }
    steps: ConnectionStep[]
  }): Promise<string> {
    const { tenantId, waba, phone } = input
    const ring = this.options.keyRing
    try {
      return await this.tenantDb.run(async (tx) => {
        const wabaRow = await tx.whatsAppBusinessAccount.upsert({
          where: { tenantId_wabaId: { tenantId, wabaId: waba.id } },
          create: {
            tenantId,
            wabaId: waba.id,
            name: waba.name,
            currency: waba.currency ?? null,
            timezoneId: waba.timezone_id ?? null,
            messageTemplateNamespace: waba.message_template_namespace ?? null,
          },
          update: {
            name: waba.name,
            currency: waba.currency ?? null,
            timezoneId: waba.timezone_id ?? null,
            messageTemplateNamespace: waba.message_template_namespace ?? null,
            status: 'ACTIVE',
          },
        })
        await this.replaceCredential(tx, tenantId, wabaRow.id, input)
        const existing = await tx.whatsAppPhoneNumber.findUnique({
          where: { tenantId_phoneNumberId: { tenantId, phoneNumberId: phone.id } },
        })
        const hasDefault =
          (await tx.whatsAppPhoneNumber.count({
            where: { isDefault: true, status: LIVE, NOT: { id: existing?.id } },
          })) > 0
        const fields = {
          wabaId: wabaRow.id,
          displayPhoneNumber: phone.display_phone_number,
          verifiedName: phone.verified_name,
          qualityRating: qualityFromMeta(phone.quality_rating),
          messagingLimitTier: phone.messaging_limit_tier ?? null,
          throughputMps: THROUGHPUT_MPS[phone.throughput?.level ?? ''] ?? 80,
          status: 'PENDING' as const,
          statusDetail: input.steps,
          isDefault: existing?.isDefault || !hasDefault,
          disconnectedAt: null,
        }
        const row = existing
          ? await tx.whatsAppPhoneNumber.update({
              where: { id: existing.id },
              data: {
                ...fields,
                registrationPinCiphertext:
                  existing.registrationPinCiphertext ?? encryptSecret(ring, randomPin()),
              },
            })
          : await tx.whatsAppPhoneNumber.create({
              data: {
                ...fields,
                tenantId,
                phoneNumberId: phone.id,
                registrationPinCiphertext: encryptSecret(ring, randomPin()),
              },
            })
        await this.audit.write(tx, {
          action: 'whatsapp.connection_started',
          targetType: 'whatsapp_phone_number',
          targetId: row.id,
          changes: {
            phoneNumberId: phone.id,
            wabaId: waba.id,
            method: input.tokenType === 'DEV' ? 'dev_connect' : 'embedded_signup',
          },
        })
        return row.id
      })
    } catch (err) {
      // Lost a race with another tenant for the same number: the partial unique index decides.
      if (isUniqueViolation(err)) throw alreadyConnected()
      throw err
    }
  }

  /** Old live credentials of the WABA become REVOKED with their ciphertext wiped. */
  private async replaceCredential(
    tx: TenantTx,
    tenantId: string,
    wabaRowId: string,
    input: {
      token: string
      tokenType: TokenType
      scopes: string[]
      credential: { status: 'VALID' | 'EXPIRING'; expiresAt: Date | null }
    },
    rotated = false,
  ): Promise<void> {
    await tx.metaCredential.updateMany({
      where: { wabaId: wabaRowId, status: { not: 'REVOKED' } },
      data: { status: 'REVOKED', tokenCiphertext: null },
    })
    await tx.metaCredential.create({
      data: {
        tenantId,
        wabaId: wabaRowId,
        tokenCiphertext: encryptSecret(this.options.keyRing, input.token),
        ...tokenParts(input.token),
        tokenType: input.tokenType,
        scopes: input.scopes,
        expiresAt: input.credential.expiresAt,
        status: input.credential.status,
        lastCheckedAt: new Date(),
        rotatedAt: rotated ? new Date() : null,
      },
    })
  }

  /** Steps 6–8 (SUBSCRIBE, REGISTER, VALIDATE), resuming after the last completed one. */
  private async runRemaining(phoneId: string): Promise<WhatsAppConnection> {
    const { tenantId } = currentTenant()
    const loaded = await this.tenantDb.run((tx) => this.loadWithToken(tx, phoneId))
    const { phone, credential, token } = loaded
    if (!credential || !token)
      throw new AppError(
        'CONFLICT',
        409,
        'This connection has no valid token. Rotate the token or connect again.',
      )
    let steps = readSteps(phone.statusDetail).map((s) =>
      s.status === 'FAILED' ? { key: s.key, status: 'PENDING' as const } : s,
    )
    const pending = (key: ConnectionStepKey) =>
      steps.find((s) => s.key === key)?.status === 'PENDING'
    let current: ConnectionStepKey = 'SUBSCRIBE'
    let details: PhoneNumberDetails | undefined
    try {
      if (pending('SUBSCRIBE')) {
        await this.graph.subscribeApp(token, phone.waba.wabaId)
        await this.tenantDb.run((tx) => this.upsertWebhook(tx, tenantId, phone.waba.id, 'ACTIVE'))
        steps = setStep(steps, 'SUBSCRIBE', 'DONE')
      }
      current = 'REGISTER'
      if (pending('REGISTER')) {
        // Test numbers (dev connect) come pre-registered; so do numbers Meta already reports live.
        const live = await this.graph.getPhoneNumber(token, phone.phoneNumberId)
        if (credential.tokenType === 'DEV' || live.status === 'CONNECTED') {
          steps = setStep(steps, 'REGISTER', 'SKIPPED')
        } else {
          const pin = decryptToken(this.options, phone.registrationPinCiphertext)
          if (!pin) throw new StepFailure('REGISTRATION_PIN_MISSING', 'No registration PIN stored.')
          await this.graph.registerPhoneNumber(token, phone.phoneNumberId, pin)
          steps = setStep(steps, 'REGISTER', 'DONE')
        }
      }
      current = 'VALIDATE'
      details = await this.graph.getPhoneNumber(token, phone.phoneNumberId)
      const status = phoneStatusFromMeta(details.status, 'PENDING')
      if (status === 'PENDING' || status === 'ERROR')
        throw new StepFailure(
          'META_PHONE_NOT_CONNECTED',
          `Meta reports this number as ${details.status ?? 'unknown'}. Finish setup in WhatsApp Manager, then retry.`,
        )
      steps = setStep(steps, 'VALIDATE', 'DONE')
    } catch (err) {
      const error = stepError(err)
      if (!error) throw err
      steps = setStep(steps, current, 'FAILED', error)
      await this.tenantDb.run(async (tx) => {
        await tx.whatsAppPhoneNumber.update({
          where: { id: phone.id },
          data: { status: 'ERROR', statusDetail: steps },
        })
        if (current === 'SUBSCRIBE') await this.upsertWebhook(tx, tenantId, phone.waba.id, 'FAILED')
        if (err instanceof GraphError && err.classification === 'CREDENTIAL')
          await tx.metaCredential.update({
            where: { id: credential.id },
            data: { status: 'INVALID' },
          })
        await this.audit.write(tx, {
          action: 'whatsapp.connection_failed',
          targetType: 'whatsapp_phone_number',
          targetId: phone.id,
          changes: { step: current, reason: error.code },
        })
      })
      return this.get(phone.id)
    }

    const now = new Date()
    await this.tenantDb.run(async (tx) => {
      await tx.whatsAppPhoneNumber.update({
        where: { id: phone.id },
        data: {
          status: phoneStatusFromMeta(details.status, 'CONNECTED'),
          statusDetail: steps,
          qualityRating: qualityFromMeta(details.quality_rating),
          messagingLimitTier: details.messaging_limit_tier ?? phone.messagingLimitTier,
          displayPhoneNumber: details.display_phone_number || phone.displayPhoneNumber,
          verifiedName: details.verified_name || phone.verifiedName,
          connectedAt: now,
          lastSyncedAt: now,
        },
      })
      await this.audit.write(tx, {
        action: 'whatsapp.connected',
        targetType: 'whatsapp_phone_number',
        targetId: phone.id,
        changes: { phoneNumberId: phone.phoneNumberId, wabaId: phone.waba.wabaId },
      })
      await emitConnectionChanged(tx, tenantId, phone.id, 'CONNECTED')
    })
    return this.get(phone.id)
  }

  async retry(id: string): Promise<WhatsAppConnection> {
    await this.tenantDb.run((tx) => this.findLive(tx, id))
    return this.runRemaining(id)
  }

  // ------------------------------------------------------------------------------------------
  // Management
  // ------------------------------------------------------------------------------------------

  /**
   * Live Graph check plus an optional hello_world to `to`.
   * TODO(phase-5): send through MessagingService → whatsapp.outbound instead of calling Graph here.
   */
  async test(id: string, to?: string): Promise<TestConnectionResult> {
    const { tenantId } = currentTenant()
    await this.limits.consume([
      { bucket: 'whatsapp-test:tenant', key: tenantId, limit: 30, windowSeconds: 3600 },
      ...(to
        ? [{ bucket: 'whatsapp-test-send:tenant', key: tenantId, limit: 10, windowSeconds: 3600 }]
        : []),
    ])
    const { phone, credential, token } = await this.tenantDb.run((tx) => this.loadWithToken(tx, id))
    const result = (error?: { code: string; message: string }): TestConnectionResult => ({
      ok: !error,
      status: phone.status,
      qualityRating: phone.qualityRating,
      ...(error ? { error } : {}),
    })
    if (!credential || !token)
      return result({ code: 'NO_CREDENTIAL', message: 'This connection has no valid token.' })
    try {
      const details = await this.graph.getPhoneNumber(token, phone.phoneNumberId)
      phone.qualityRating = qualityFromMeta(details.quality_rating)
      await this.tenantDb.run((tx) =>
        tx.whatsAppPhoneNumber.update({
          where: { id: phone.id },
          data: { qualityRating: phone.qualityRating, lastSyncedAt: new Date() },
        }),
      )
      if (!to) return result()
      const sent = await this.graph.sendTestTemplate(token, phone.phoneNumberId, to)
      await this.tenantDb.run((tx) =>
        this.audit.write(tx, {
          action: 'whatsapp.test_message_sent',
          targetType: 'whatsapp_phone_number',
          targetId: phone.id,
        }),
      )
      return { ...result(), message: sent }
    } catch (err) {
      if (!(err instanceof GraphError)) throw err
      if (err.classification === 'CREDENTIAL')
        await this.tenantDb.run((tx) =>
          tx.metaCredential.update({ where: { id: credential.id }, data: { status: 'INVALID' } }),
        )
      return result(stepError(err)!)
    }
  }

  async sync(id: string): Promise<WhatsAppConnection> {
    const { tenantId } = currentTenant()
    await this.limits.consume([
      { bucket: 'whatsapp-sync:tenant', key: tenantId, limit: 30, windowSeconds: 3600 },
    ])
    await this.tenantDb.run((tx) => this.findLive(tx, id))
    let outcome: SyncOutcome
    try {
      outcome = await this.syncService.syncPhone(tenantId, id)
    } catch (err) {
      if (err instanceof GraphError)
        throw new AppError(
          'UPSTREAM_UNAVAILABLE',
          503,
          'Meta is not responding. Try again shortly.',
        )
      throw err
    }
    if (outcome === 'skipped')
      throw new AppError('CONFLICT', 409, 'Finish connecting this number before syncing it.')
    return this.get(id)
  }

  async rotateToken(id: string, input: RotateTokenRequest): Promise<WhatsAppConnection> {
    const { tenantId } = currentTenant()
    await this.limits.consume([
      { bucket: 'whatsapp-connect:tenant', key: tenantId, limit: 20, windowSeconds: 3600 },
    ])
    const phone = await this.tenantDb.run((tx) => this.findLive(tx, id))
    let token: string
    let tokenType: TokenType
    try {
      if (input.code) {
        const { appId, appSecret } = this.options
        if (!appId || !appSecret)
          throw new AppError(
            'UNPROCESSABLE',
            422,
            'Embedded Signup is not configured on this server.',
          )
        token = await this.graph.exchangeCode(appId, appSecret, input.code)
        tokenType = 'BUSINESS_INTEGRATION'
      } else {
        if (!this.options.devConnect) throw AppError.notFound()
        token = input.accessToken!
        tokenType = 'DEV'
      }
      const info = await verifyToken(this.graph, this.options, token, phone.waba.wabaId)
      await this.tenantDb.run(async (tx) => {
        await this.replaceCredential(
          tx,
          tenantId,
          phone.waba.id,
          {
            token,
            tokenType,
            scopes: info.scopes,
            credential: credentialStatusFor(info.expiresAt),
          },
          true,
        )
        await this.audit.write(tx, {
          action: 'whatsapp.token_rotated',
          targetType: 'whatsapp_phone_number',
          targetId: phone.id,
          changes: { method: tokenType === 'DEV' ? 'dev_connect' : 'embedded_signup' },
        })
        await emitConnectionChanged(tx, tenantId, phone.id, 'CREDENTIAL_CHANGED')
      })
    } catch (err) {
      const error = stepError(err)
      if (!error) throw err
      throw new AppError('WHATSAPP_CONNECT_FAILED', 422, error.message, { reason: error.code })
    }
    return this.get(id)
  }

  async update(id: string, input: UpdateConnectionRequest): Promise<WhatsAppConnection> {
    await this.tenantDb.run(async (tx) => {
      const phone = await this.findLive(tx, id)
      const changes: Record<string, unknown> = {}
      if (input.isDefault && !phone.isDefault) {
        // Clear first: the partial unique index allows one default per tenant.
        await tx.whatsAppPhoneNumber.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        })
        await tx.whatsAppPhoneNumber.update({ where: { id }, data: { isDefault: true } })
        changes.isDefault = [false, true]
      }
      if (input.label !== undefined && input.label !== phone.label) {
        const label = input.label || null
        await tx.whatsAppPhoneNumber.update({ where: { id }, data: { label } })
        changes.label = [phone.label, label]
      }
      if (Object.keys(changes).length > 0)
        await this.audit.write(tx, {
          action: 'whatsapp.connection_updated',
          targetType: 'whatsapp_phone_number',
          targetId: id,
          changes,
        })
    })
    return this.get(id)
  }

  /**
   * Unsubscribes the app from the WABA (unless another live number of this tenant still uses it),
   * wipes the credential, and marks the number DISCONNECTED. A Meta failure while unsubscribing
   * doesn't block disconnecting; it is recorded in the audit entry.
   */
  async disconnect(id: string): Promise<void> {
    const { tenantId } = currentTenant()
    const { phone, token, siblings } = await this.tenantDb.run(async (tx) => {
      const loaded = await this.loadWithToken(tx, id)
      const siblings = await tx.whatsAppPhoneNumber.count({
        where: { wabaId: loaded.phone.wabaId, status: LIVE, NOT: { id } },
      })
      return { ...loaded, siblings }
    })
    let webhooks: 'unsubscribed' | 'kept' | 'failed' | 'no_token' = 'kept'
    if (siblings === 0) {
      if (!token) webhooks = 'no_token'
      else {
        try {
          await this.graph.unsubscribeApp(token, phone.waba.wabaId)
          webhooks = 'unsubscribed'
        } catch (err) {
          if (!(err instanceof GraphError)) throw err
          webhooks = 'failed'
        }
      }
    }
    await this.tenantDb.run(async (tx) => {
      await tx.whatsAppPhoneNumber.update({
        where: { id },
        data: {
          status: 'DISCONNECTED',
          isDefault: false,
          disconnectedAt: new Date(),
          registrationPinCiphertext: null,
        },
      })
      if (siblings === 0) {
        await tx.metaCredential.updateMany({
          where: { wabaId: phone.waba.id },
          data: { status: 'REVOKED', tokenCiphertext: null },
        })
        await tx.webhookSubscription.updateMany({
          where: { wabaId: phone.waba.id },
          data: { status: 'REMOVED', lastCheckedAt: new Date() },
        })
        await tx.whatsAppBusinessAccount.update({
          where: { id: phone.waba.id },
          data: { status: 'DISCONNECTED' },
        })
      }
      if (phone.isDefault) {
        const next = await tx.whatsAppPhoneNumber.findFirst({
          where: { status: LIVE },
          orderBy: { createdAt: 'asc' },
        })
        if (next)
          await tx.whatsAppPhoneNumber.update({ where: { id: next.id }, data: { isDefault: true } })
      }
      await this.audit.write(tx, {
        action: 'whatsapp.disconnected',
        targetType: 'whatsapp_phone_number',
        targetId: id,
        changes: { phoneNumberId: phone.phoneNumberId, webhooks },
      })
      await emitConnectionChanged(tx, tenantId, id, 'DISCONNECTED')
    })
  }

  // ------------------------------------------------------------------------------------------

  private async findLive(tx: TenantTx, id: string) {
    const phone = await tx.whatsAppPhoneNumber.findFirst({
      where: { id, status: LIVE },
      include: CONNECTION_INCLUDE,
    })
    if (!phone) throw AppError.notFound('WhatsApp connection not found.')
    return phone
  }

  private async loadWithToken(tx: TenantTx, id: string) {
    const phone = await this.findLive(tx, id)
    const credential = await tx.metaCredential.findFirst({
      where: { wabaId: phone.wabaId, status: { in: ['VALID', 'EXPIRING'] } },
      orderBy: { createdAt: 'desc' },
    })
    return {
      phone,
      credential,
      token: decryptToken(this.options, credential?.tokenCiphertext ?? null),
    }
  }

  private async upsertWebhook(
    tx: TenantTx,
    tenantId: string,
    wabaRowId: string,
    status: 'ACTIVE' | 'FAILED',
  ): Promise<void> {
    await tx.webhookSubscription.upsert({
      where: { tenantId_wabaId: { tenantId, wabaId: wabaRowId } },
      create: { tenantId, wabaId: wabaRowId, subscribedFields: SUBSCRIBED_FIELDS, status },
      update: { subscribedFields: SUBSCRIBED_FIELDS, status, lastCheckedAt: new Date() },
    })
  }
}

/** Two-step verification PIN we set when registering a number (stored encrypted). */
const randomPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0')
