import { uuidv7 } from '@fenwira/config'
import {
  type ApprovedTemplate,
  type CreateTemplate,
  type Template,
  TEMPLATE_HEADER_MEDIA,
  type TemplateComponents,
  type TemplateDraft,
  type TemplateValidation,
  type TemplateVersion,
  type UpdateTemplate,
  validateTemplate,
  type VariableSamples,
} from '@fenwira/contracts'
import { Database, Prisma, type TenantTx } from '@fenwira/database'
import { GraphClient, GraphError, toMetaTemplatePayload } from '@fenwira/whatsapp'
import { Inject, Injectable } from '@nestjs/common'
import { likeLiteral } from '../../core/database/like'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { StorageService } from '../../core/storage/storage.service'
import { verifyUpload } from '../../core/storage/uploads'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { loadLiveToken } from '../whatsapp-accounts'
import { type SyncResult, TemplateSyncService } from './template-sync.service'
import {
  type Push,
  TEMPLATE_INCLUDE,
  toTemplate,
  toVersion,
  transitionVersion,
} from './templates.core'
import { TEMPLATES_GRAPH, TEMPLATES_OPTIONS, type TemplatesOptions } from './templates.options'

type TemplateRow = Prisma.TemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
const nameTaken = (name: string, language: string) =>
  new AppError(
    'TEMPLATE_NAME_TAKEN',
    409,
    `A template named ${name} already exists in ${language} on this WhatsApp Business Account.`,
    { field: 'name' },
  )
const invalid = (v: TemplateValidation) =>
  new AppError('TEMPLATE_INVALID', 422, 'Fix the highlighted problems before submitting.', {
    errors: v.errors,
    warnings: v.warnings,
  })
/** Meta already has this name + language (a lost response on an earlier submit, or made elsewhere). */
const ALREADY_EXISTS_SUBCODES = new Set([2388023, 2388024])

/**
 * Templates (docs/TEMPLATE_ENGINE.md): drafts, validation (shared with the UI), submission to
 * Meta, versions, deletion and sync. Meta calls run outside DB transactions.
 */
@Injectable()
export class TemplatesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly tenantDb: TenantDb,
    @Inject(TEMPLATES_OPTIONS) private readonly options: TemplatesOptions,
    @Inject(TEMPLATES_GRAPH) private readonly graph: GraphClient,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeEmitter,
    private readonly syncer: TemplateSyncService,
  ) {}

  // ------------------------------------------------------------------------------ reads

  list(q: {
    status?: Template['status']
    category?: Template['category']
    language?: string
    wabaId?: string
    q?: string
  }): Promise<Template[]> {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.template.findMany({
        where: {
          deletedAt: null,
          ...(q.status ? { status: q.status } : {}),
          ...(q.category ? { category: q.category } : {}),
          ...(q.language ? { language: q.language } : {}),
          ...(q.wabaId ? { wabaId: q.wabaId } : {}),
          ...(q.q ? { name: { contains: likeLiteral(q.q.toLowerCase()) } } : {}),
        },
        include: TEMPLATE_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        take: 500,
      })
      return rows.map(toTemplate)
    })
  }

  /** Picker entries: templates with an APPROVED version that Meta is serving (not paused/disabled). */
  approved(q: { language?: string; phoneNumberId?: string }): Promise<ApprovedTemplate[]> {
    return this.tenantDb.run(async (tx) => {
      const phone = q.phoneNumberId
        ? await tx.whatsAppPhoneNumber.findFirst({ where: { id: q.phoneNumberId } })
        : null
      if (q.phoneNumberId && !phone) throw AppError.notFound('Phone number not found.')
      const rows = await tx.template.findMany({
        where: {
          deletedAt: null,
          approvedVersionId: { not: null },
          status: { notIn: ['PAUSED', 'DISABLED', 'ARCHIVED'] },
          ...(q.language ? { language: q.language } : {}),
          ...(phone ? { wabaId: phone.wabaId } : {}),
        },
        include: TEMPLATE_INCLUDE,
        orderBy: [{ name: 'asc' }, { language: 'asc' }],
      })
      return rows.flatMap((t) => {
        const v = t.versions.find((x) => x.id === t.approvedVersionId)
        if (!v || v.status !== 'APPROVED') return []
        return [
          {
            templateId: t.id,
            versionId: v.id,
            wabaId: t.wabaId,
            name: t.name,
            language: t.language,
            category: t.category,
            components: v.components as TemplateComponents,
            samples: v.variableSamples as VariableSamples,
          },
        ]
      })
    })
  }

  /** WABAs with a live connection: where new templates can be created. */
  accounts(): Promise<Array<{ id: string; name: string; metaWabaId: string }>> {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.whatsAppBusinessAccount.findMany({
        where: {
          status: { in: ['ACTIVE', 'RESTRICTED'] },
          phoneNumbers: { some: { status: { notIn: ['DISCONNECTED', 'PENDING'] } } },
        },
        orderBy: { name: 'asc' },
      })
      return rows.map((w) => ({ id: w.id, name: w.name, metaWabaId: w.wabaId }))
    })
  }

  get(id: string): Promise<Template> {
    return this.tenantDb.run(async (tx) => toTemplate(await this.find(tx, id)))
  }

  versions(id: string): Promise<TemplateVersion[]> {
    return this.tenantDb.run(async (tx) => (await this.find(tx, id)).versions.map(toVersion))
  }

  // ------------------------------------------------------------------------------ drafts

  /** Dry run of the shared validation, plus the server-only checks (name taken, sample file). */
  validate(
    draft: TemplateDraft & { wabaId?: string },
    templateId?: string,
  ): Promise<TemplateValidation> {
    return this.tenantDb.run((tx) => this.fullValidation(tx, draft, templateId))
  }

  async create(input: CreateTemplate): Promise<Template> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    const shared = validateTemplate(input)
    const nameError = shared.errors.find((e) => e.code === 'TEMPLATE_NAME_INVALID')
    if (nameError) throw invalid({ valid: false, errors: [nameError], warnings: [] })
    try {
      return await this.tenantDb.run(async (tx) => {
        const waba = await tx.whatsAppBusinessAccount.findFirst({
          where: { id: input.wabaId, status: { not: 'DISCONNECTED' } },
        })
        if (!waba) throw AppError.notFound('WhatsApp Business Account not found.')
        await this.assertNameFree(tx, input.wabaId, input.name, input.language)
        await this.assertSample(tx, input.components)
        const template = await tx.template.create({
          data: {
            tenantId,
            wabaId: input.wabaId,
            name: input.name,
            language: input.language,
            category: input.category,
            createdBy: userId,
          },
        })
        const v = await tx.templateVersion.create({
          data: {
            tenantId,
            templateId: template.id,
            version: 1,
            components: input.components as object,
            variableSamples: input.samples as object,
            sampleFileId: sampleOf(input.components),
            createdBy: userId,
          },
        })
        await tx.template.update({ where: { id: template.id }, data: { currentVersionId: v.id } })
        await this.audit.write(tx, {
          action: 'template.created',
          targetType: 'template',
          targetId: template.id,
          changes: { name: input.name, language: input.language, category: input.category },
        })
        return toTemplate(await this.find(tx, template.id))
      })
    } catch (err) {
      throw isUniqueViolation(err) ? nameTaken(input.name, input.language) : err
    }
  }

  /** Edits the current DRAFT. Name, language and category can change only before Meta knows it. */
  async update(id: string, input: UpdateTemplate): Promise<Template> {
    try {
      return await this.tenantDb.run(async (tx) => {
        const t = await this.find(tx, id)
        const current = t.versions.find((v) => v.id === t.currentVersionId)!
        if (current.status !== 'DRAFT')
          throw new AppError(
            'TEMPLATE_NOT_EDITABLE',
            409,
            'Only drafts can be edited. Create a new version to change a submitted template.',
          )
        const identity = { name: input.name, language: input.language, category: input.category }
        const submittedBefore = t.versions.some((v) => v.metaTemplateId)
        if (
          submittedBefore &&
          ((identity.name && identity.name !== t.name) ||
            (identity.language && identity.language !== t.language))
        )
          throw new AppError(
            'TEMPLATE_NOT_EDITABLE',
            409,
            "A submitted template's name and language can't change.",
          )
        if (identity.name && !/^[a-z0-9_]+$/.test(identity.name))
          throw invalid({
            valid: false,
            errors: validateTemplate({
              name: identity.name,
              language: t.language,
              category: t.category,
              components: current.components as TemplateComponents,
              samples: current.variableSamples as VariableSamples,
            }).errors.filter((e) => e.code === 'TEMPLATE_NAME_INVALID'),
            warnings: [],
          })
        if (
          (identity.name && identity.name !== t.name) ||
          (identity.language && identity.language !== t.language)
        )
          await this.assertNameFree(
            tx,
            t.wabaId,
            identity.name ?? t.name,
            identity.language ?? t.language,
            t.id,
          )
        if (input.components) await this.assertSample(tx, input.components)
        await tx.templateVersion.update({
          where: { id: current.id },
          data: {
            ...(input.components
              ? {
                  components: input.components as object,
                  sampleFileId: sampleOf(input.components),
                }
              : {}),
            ...(input.samples ? { variableSamples: input.samples as object } : {}),
            lastError: null,
          },
        })
        await tx.template.update({
          where: { id: t.id },
          data: {
            ...(identity.name ? { name: identity.name } : {}),
            ...(identity.language ? { language: identity.language } : {}),
            ...(identity.category && !submittedBefore ? { category: identity.category } : {}),
          },
        })
        return toTemplate(await this.find(tx, id))
      })
    } catch (err) {
      throw isUniqueViolation(err) ? nameTaken(input.name ?? '', input.language ?? '') : err
    }
  }

  /** Editing an approved or rejected template: version N+1 as a DRAFT, copied from the current. */
  newVersion(id: string): Promise<Template> {
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      const t = await this.find(tx, id)
      const current = t.versions.find((v) => v.id === t.currentVersionId)!
      if (current.status === 'DRAFT') return toTemplate(t)
      if (current.status === 'PENDING')
        throw new AppError(
          'TEMPLATE_NOT_EDITABLE',
          409,
          'Meta is reviewing this template. Wait for the decision before editing it.',
        )
      const next = (t.versions[0]?.version ?? 0) + 1
      const v = await tx.templateVersion.create({
        data: {
          tenantId: t.tenantId,
          templateId: t.id,
          version: next,
          components: current.components as object,
          variableSamples: current.variableSamples as object,
          sampleFileId: current.sampleFileId,
          createdBy: userId,
        },
      })
      await tx.template.update({
        where: { id: t.id },
        data: { currentVersionId: v.id, status: 'DRAFT' },
      })
      await this.audit.write(tx, {
        action: 'template.version_created',
        targetType: 'template',
        targetId: t.id,
        changes: { version: next },
      })
      return toTemplate(await this.find(tx, id))
    })
  }

  // ------------------------------------------------------------------------------ samples

  /** Presigned upload for a header sample (JPEG/PNG, MP4 or PDF within Meta's limits). */
  async sampleUpload(input: { mimeType: string; sizeBytes: number; filename?: string }) {
    const { tenantId } = currentTenant()
    const format = Object.entries(TEMPLATE_HEADER_MEDIA).find(([, l]) =>
      l.mime.test(input.mimeType),
    )
    if (!format || input.sizeBytes > format[1].max)
      throw AppError.validation([
        {
          path: 'mimeType',
          code: 'unsupported',
          message:
            'Use a JPEG or PNG image up to 5 MB, an MP4 video up to 16 MB, or a PDF up to 100 MB.',
        },
      ])
    const id = uuidv7()
    const objectKey = `${tenantId}/template-samples/${id}`
    await this.tenantDb.run((tx) =>
      tx.file.create({
        data: {
          id,
          tenantId,
          bucket: this.storage.mediaBucket,
          objectKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          filename: input.filename ?? null,
          purpose: 'TEMPLATE_SAMPLE',
          uploadedBy: currentAuth().userId,
        },
      }),
    )
    const expiresIn = 900
    return {
      fileId: id,
      url: await this.storage.presignPut(
        this.storage.mediaBucket,
        objectKey,
        input.mimeType,
        input.sizeBytes,
        expiresIn,
      ),
      headers: { 'Content-Type': input.mimeType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }

  async completeSample(fileId: string) {
    const file = await this.tenantDb.run((tx) =>
      tx.file.findFirst({ where: { id: fileId, purpose: 'TEMPLATE_SAMPLE' } }),
    )
    if (!file) throw AppError.notFound('File not found.')
    if (file.status !== 'PENDING_UPLOAD') return { id: file.id, status: file.status }
    const ok = await verifyUpload(this.storage, file)
    if (ok === null) throw new AppError('FILE_NOT_READY', 422, 'The upload has not finished yet.')
    const updated = await this.tenantDb.run((tx) =>
      tx.file.update({ where: { id: fileId }, data: { status: ok ? 'READY' : 'REJECTED' } }),
    )
    return { id: updated.id, status: updated.status }
  }

  async sampleUrl(fileId: string) {
    const file = await this.tenantDb.run((tx) =>
      tx.file.findFirst({ where: { id: fileId, purpose: 'TEMPLATE_SAMPLE', status: 'READY' } }),
    )
    if (!file) throw AppError.notFound('File not found.')
    const expiresIn = 300
    return {
      url: await this.storage.presignGet(file.bucket, file.objectKey, expiresIn),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }

  // ------------------------------------------------------------------------------ Meta

  /**
   * Submission (docs/TEMPLATE_ENGINE.md → Submission). A transport, rate-limit or credential
   * failure is never a rejection: the version stays DRAFT with `last_error` and can be retried.
   * Only Meta's own 4xx validation produces REJECTED (with Meta's reason).
   */
  async submit(id: string): Promise<Template> {
    const { tenantId } = currentTenant()
    const prepared = await this.tenantDb.run(async (tx) => {
      const t = await this.find(tx, id)
      const current = t.versions.find((v) => v.id === t.currentVersionId)!
      if (current.status !== 'DRAFT')
        throw new AppError(
          'TEMPLATE_NOT_EDITABLE',
          409,
          'Only a draft can be submitted. Create a new version to change a submitted template.',
        )
      const draft = {
        name: t.name,
        language: t.language,
        category: t.category,
        components: current.components as TemplateComponents,
        samples: current.variableSamples as VariableSamples,
      }
      const v = await this.fullValidation(tx, { ...draft, wabaId: t.wabaId }, t.id)
      if (!v.valid) throw invalid(v)
      const waba = await tx.whatsAppBusinessAccount.findFirstOrThrow({ where: { id: t.wabaId } })
      const token = await loadLiveToken(tx, this.options.keyRing, waba.id)
      if (!token)
        throw new AppError(
          'NO_CONNECTED_NUMBER',
          422,
          'This WhatsApp Business Account has no valid Meta connection. Reconnect it in Settings → WhatsApp.',
        )
      const sample = current.sampleFileId
        ? await tx.file.findFirst({ where: { id: current.sampleFileId } })
        : null
      return {
        draft,
        versionId: current.id,
        metaWabaId: waba.wabaId,
        token: token.token,
        editOf: t.versions.find((x) => x.metaTemplateId)?.metaTemplateId ?? null,
        sample,
      }
    })

    let metaId: string | null = prepared.editOf
    let outcome: { status: 'PENDING' | 'APPROVED' | 'REJECTED'; reason?: string } = {
      status: 'PENDING',
    }
    try {
      const headerHandle = prepared.sample
        ? await this.graph.uploadSample(prepared.token, this.options.appId ?? 'app', {
            bytes: await this.storage.getBytes(prepared.sample.bucket, prepared.sample.objectKey),
            mimeType: prepared.sample.mimeType,
            name: prepared.sample.filename ?? `sample-${prepared.sample.id}`,
          })
        : undefined
      const payload = toMetaTemplatePayload(prepared.draft, headerHandle)
      if (metaId) {
        const { name: _name, language: _language, ...edit } = payload
        await this.graph.editTemplate(prepared.token, metaId, edit)
      } else {
        const created = await this.graph.createTemplate(
          prepared.token,
          prepared.metaWabaId,
          payload,
        )
        metaId = created.id
        if (created.status === 'APPROVED' || created.status === 'REJECTED')
          outcome = { status: created.status }
      }
    } catch (err) {
      if (!(err instanceof GraphError)) throw err
      const exists =
        !metaId && err.subcode !== undefined && ALREADY_EXISTS_SUBCODES.has(err.subcode)
      const adopted = exists
        ? await this.findRemoteId(prepared.token, prepared.metaWabaId, prepared.draft).catch(
            () => null,
          )
        : null
      if (adopted) {
        // An earlier submit reached Meta without us seeing the answer: continue with that template.
        metaId = adopted
      } else if (
        err.classification === 'PERMANENT' &&
        err.httpStatus !== undefined &&
        err.httpStatus < 500
      ) {
        // Meta refused the content itself: that is a rejection, with Meta's reason.
        outcome = { status: 'REJECTED', reason: err.userMessage ?? err.message }
      } else {
        // Transport, rate limit or credential trouble: never REJECTED; stays a retryable draft.
        return this.keepDraft(id, prepared.versionId, err)
      }
    }

    const pushes: Push[] = []
    const template = await this.db.withTenant(tenantId, async (tx) => {
      await tx.templateVersion.update({
        where: { id: prepared.versionId },
        data: {
          metaTemplateId: metaId,
          submittedAt: new Date(),
          lastError: null,
          status: 'PENDING',
        },
      })
      await tx.template.update({ where: { id }, data: { status: 'PENDING' } })
      if (outcome.status !== 'PENDING')
        pushes.push(
          ...(await transitionVersion(tx, tenantId, prepared.versionId, outcome.status, {
            rejectionReason: outcome.reason ?? null,
          })),
        )
      await this.audit.write(tx, {
        action: 'template.submitted',
        targetType: 'template',
        targetId: id,
        changes: { metaTemplateId: metaId, result: outcome.status },
      })
      return toTemplate(await this.find(tx, id))
    })
    for (const p of pushes) this.realtime.toUser(p.userId, 'notification.created', p.notification)
    return template
  }

  /** Deletes at Meta (every language of the name) and in Fenwira. */
  async remove(id: string): Promise<void> {
    const { tenantId } = currentTenant()
    const t = await this.tenantDb.run(async (tx) => {
      const row = await this.find(tx, id)
      const waba = await tx.whatsAppBusinessAccount.findFirstOrThrow({ where: { id: row.wabaId } })
      const token = await loadLiveToken(tx, this.options.keyRing, waba.id)
      return { row, metaWabaId: waba.wabaId, token: token?.token ?? null }
    })
    if (t.row.versions.some((v) => v.metaTemplateId)) {
      if (!t.token)
        throw new AppError(
          'NO_CONNECTED_NUMBER',
          422,
          'Reconnect this WhatsApp Business Account to delete the template at Meta.',
        )
      try {
        await this.graph.deleteTemplate(t.token, t.metaWabaId, t.row.name)
      } catch (err) {
        // Already gone at Meta is fine; anything else is reported and nothing changes here.
        if (!(err instanceof GraphError) || err.httpStatus !== 404)
          throw new AppError(
            'UPSTREAM_UNAVAILABLE',
            503,
            `Meta didn't delete the template: ${err instanceof Error ? err.message : 'unknown error'}`,
          )
      }
    }
    await this.db.withTenant(tenantId, async (tx) => {
      // Meta deletes the name in every language, so every live language goes here too.
      const same = await tx.template.findMany({
        where: {
          wabaId: t.row.wabaId,
          name: t.row.name,
          deletedAt: null,
          ...(t.row.versions.some((v) => v.metaTemplateId) ? {} : { id }),
        },
        select: { id: true },
      })
      await tx.template.updateMany({
        where: { id: { in: same.map((s) => s.id) } },
        data: { deletedAt: new Date(), status: 'ARCHIVED' },
      })
      await this.audit.write(tx, {
        action: 'template.deleted',
        targetType: 'template',
        targetId: id,
        changes: { name: t.row.name, languages: same.length },
      })
    })
  }

  /** `POST /templates/sync`: every live WABA of the workspace, or one. */
  async sync(wabaId?: string): Promise<SyncResult[]> {
    const { tenantId } = currentTenant()
    const wabas = await this.tenantDb.run((tx) =>
      tx.whatsAppBusinessAccount.findMany({
        where: { status: { in: ['ACTIVE', 'RESTRICTED'] }, ...(wabaId ? { id: wabaId } : {}) },
        select: { id: true },
      }),
    )
    const results: SyncResult[] = []
    for (const w of wabas) {
      try {
        const r = await this.syncer.syncWaba(tenantId, w.id)
        if (r) results.push(r)
      } catch (err) {
        if (err instanceof GraphError)
          throw new AppError('UPSTREAM_UNAVAILABLE', 503, `Meta sync failed: ${err.message}`)
        throw err
      }
    }
    await this.tenantDb.run((tx) =>
      this.audit.write(tx, {
        action: 'templates.synced',
        targetType: 'workspace',
        targetId: tenantId,
        changes: { wabas: results.length },
      }),
    )
    return results
  }

  // ------------------------------------------------------------------------------ helpers

  private async find(tx: TenantTx, id: string): Promise<TemplateRow> {
    const t = await tx.template.findFirst({
      where: { id, deletedAt: null },
      include: TEMPLATE_INCLUDE,
    })
    if (!t) throw AppError.notFound('Template not found.')
    return t
  }

  private async assertNameFree(
    tx: TenantTx,
    wabaId: string,
    name: string,
    language: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await tx.template.findFirst({
      where: {
        wabaId,
        name,
        language,
        deletedAt: null,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    })
    if (clash) throw nameTaken(name, language)
  }

  /** A media header's sample must be a READY TEMPLATE_SAMPLE file of the matching type. */
  private async assertSample(tx: TenantTx, components: TemplateComponents): Promise<void> {
    const issue = await this.sampleIssue(tx, components)
    if (issue)
      throw invalid({
        valid: false,
        errors: [
          {
            code: 'TEMPLATE_MEDIA_INVALID',
            path: 'components.header.sampleFileId',
            message: issue,
          },
        ],
        warnings: [],
      })
  }

  private async sampleIssue(tx: TenantTx, c: TemplateComponents): Promise<string | null> {
    if (!c.header || c.header.format === 'TEXT' || !c.header.sampleFileId) return null
    const file = await tx.file.findFirst({
      where: { id: c.header.sampleFileId, purpose: 'TEMPLATE_SAMPLE' },
    })
    const limits = TEMPLATE_HEADER_MEDIA[c.header.format]
    if (!file || file.status !== 'READY') return 'Upload the sample file again.'
    if (!limits.mime.test(file.mimeType) || Number(file.sizeBytes) > limits.max)
      return `The ${c.header.format.toLowerCase()} header needs ${limits.label}.`
    return null
  }

  private async fullValidation(
    tx: TenantTx,
    draft: TemplateDraft & { wabaId?: string },
    templateId?: string,
  ): Promise<TemplateValidation> {
    const v = validateTemplate(draft)
    const errors = [...v.errors]
    if (draft.wabaId) {
      const clash = await tx.template.findFirst({
        where: {
          wabaId: draft.wabaId,
          name: draft.name,
          language: draft.language,
          deletedAt: null,
          ...(templateId ? { NOT: { id: templateId } } : {}),
        },
        select: { id: true },
      })
      if (clash)
        errors.push({
          code: 'TEMPLATE_NAME_TAKEN',
          path: 'name',
          message: 'This name is already used in this language.',
        })
    }
    const media = await this.sampleIssue(tx, draft.components)
    if (media)
      errors.push({
        code: 'TEMPLATE_MEDIA_INVALID',
        path: 'components.header.sampleFileId',
        message: media,
      })
    return { valid: errors.length === 0, errors, warnings: v.warnings }
  }

  private async keepDraft(id: string, versionId: string, err: GraphError): Promise<never> {
    const message = `${err.title}: ${err.message}`
    await this.tenantDb.run(async (tx) => {
      await tx.templateVersion.update({ where: { id: versionId }, data: { lastError: message } })
      await this.audit.write(tx, {
        action: 'template.submit_failed',
        targetType: 'template',
        targetId: id,
        changes: { code: err.fenwiraCode },
      })
    })
    throw new AppError(
      'UPSTREAM_UNAVAILABLE',
      503,
      `Meta didn't receive the template (${err.title}). It is still a draft; try again.`,
      { lastError: message },
    )
  }

  private async findRemoteId(
    token: string,
    metaWabaId: string,
    draft: { name: string; language: string },
  ): Promise<string | null> {
    let after: string | undefined
    do {
      const page = await this.graph.listTemplates(token, metaWabaId, after)
      const hit = page.data.find((m) => m.name === draft.name && m.language === draft.language)
      if (hit) return hit.id
      after = page.after
    } while (after)
    return null
  }
}

const sampleOf = (c: TemplateComponents) =>
  c.header && c.header.format !== 'TEXT' ? (c.header.sampleFileId ?? null) : null
