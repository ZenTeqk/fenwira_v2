import { type ConfigureImportRequest, type ImportJob, type ImportTarget } from '@fenwira/contracts'
import { uuidv7 } from '@fenwira/config'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { jobId, QUEUES } from '@fenwira/queue'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../../core/database/tenant-db'
import { AppError } from '../../../core/http/app-error'
import { QueueRegistry } from '../../../core/queue/queue-registry'
import { StorageService } from '../../../core/storage/storage.service'
import { AuditService } from '../../audit'
import { EntitlementsService } from '../../entitlements'
import { currentAuth } from '../../identity'
import { currentTenant } from '../../tenancy'

const CSV_MIME = /^(text\/csv|text\/plain|application\/csv|application\/vnd\.ms-excel)$/

export type ImportJobData = { tenantId: string; importJobId: string; correlationId?: string }
export const IMPORT_STEPS = { analyze: 'analyze', validate: 'validate', run: 'import' } as const

type ImportRow = Prisma.ImportJobGetPayload<{ include: { file: true } }>

export function toImportJob(j: ImportRow): ImportJob {
  return {
    id: j.id,
    status: j.status,
    filename: j.file.filename,
    headers: (j.headers as string[] | null) ?? [],
    suggestedMapping: (j.suggestedMapping as Record<string, ImportTarget> | null) ?? {},
    columnMapping: (j.columnMapping as Record<string, ImportTarget> | null) ?? null,
    duplicatePolicy: j.duplicatePolicy,
    defaultConsent: (j.defaultConsent as ImportJob['defaultConsent']) ?? null,
    counts: {
      total: j.totalRows,
      valid: j.validRows,
      invalid: j.invalidRows,
      new: j.newRows,
      existing: j.existingRows,
      processed: j.processedRows,
      created: j.createdCount,
      updated: j.updatedCount,
      skipped: j.skippedCount,
    },
    preview: (j.preview as ImportJob['preview']) ?? null,
    hasErrorReport: !!j.errorFileId,
    failureReason: j.failureReason,
    createdAt: j.createdAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
  }
}

/**
 * CSV import API (docs/CONTACTS_AND_CONSENT.md → CSV import). Each step hands off to the
 * contacts.import worker: analyze (headers, sample, suggested mapping) → validate (counts and a
 * 50-row preview) → import (1,000-row transactions with progress events).
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly queues: QueueRegistry,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Prepared connector CSV: job and analysis intent commit with the transfer receipt. */
  async prepareNative(
    tx: TenantTx,
    input: {
      tenantId: string
      id: string
      objectKey: string
      sizeBytes: number
      filename: string
      actorId: string
    },
  ): Promise<void> {
    const existing = await tx.importJob.findFirst({ where: { id: input.id } })
    if (existing) return
    await tx.file.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        bucket: this.storage.importsBucket,
        objectKey: input.objectKey,
        mimeType: 'text/csv',
        sizeBytes: input.sizeBytes,
        filename: input.filename,
        purpose: 'IMPORT',
        status: 'READY',
        uploadedBy: input.actorId,
      },
    })
    await tx.importJob.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        fileId: input.id,
        createdBy: input.actorId,
        suppressAutomations: true,
      },
    })
    await tx.outboxEvent.create({
      data: {
        tenantId: input.tenantId,
        eventType: 'contacts.import_prepared',
        aggregateType: 'import_job',
        aggregateId: input.id,
        payload: { importJobId: input.id },
      },
    })
    await this.audit.write(tx, {
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'contacts.native_import_prepared',
      targetType: 'import_job',
      targetId: input.id,
    })
  }

  async list(): Promise<ImportJob[]> {
    const rows = await this.tenantDb.run((tx) =>
      tx.importJob.findMany({ include: { file: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    )
    return rows.map(toImportJob)
  }

  async get(id: string): Promise<ImportJob> {
    return toImportJob(await this.tenantDb.run((tx) => this.find(tx, id)))
  }

  /** Presigned PUT for a contact CSV (fenwira-imports, 7-day lifecycle). */
  async uploadUrl(input: { mimeType: string; sizeBytes: number; filename?: string }) {
    const { tenantId } = currentTenant()
    if (!CSV_MIME.test(input.mimeType))
      throw AppError.validation([
        { path: 'mimeType', code: 'unsupported', message: 'Upload a CSV file.' },
      ])
    const id = uuidv7()
    const objectKey = `${tenantId}/imports/${id}`
    await this.tenantDb.run((tx) =>
      tx.file.create({
        data: {
          id,
          tenantId,
          bucket: this.storage.importsBucket,
          objectKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          filename: input.filename ?? null,
          purpose: 'IMPORT',
          uploadedBy: currentAuth().userId,
        },
      }),
    )
    const expiresIn = 900
    return {
      fileId: id,
      url: await this.storage.presignPut(
        this.storage.importsBucket,
        objectKey,
        input.mimeType,
        input.sizeBytes,
        expiresIn,
      ),
      headers: { 'Content-Type': input.mimeType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }

  /** Verifies the uploaded CSV (size, no binary content) and starts the analysis step. */
  async create(fileId: string): Promise<ImportJob> {
    const { tenantId } = currentTenant()
    const file = await this.tenantDb.run((tx) =>
      tx.file.findFirst({ where: { id: fileId, purpose: 'IMPORT' } }),
    )
    if (!file) throw AppError.notFound('File not found.')
    if (file.status === 'PENDING_UPLOAD') {
      const head = await this.storage.head(file.bucket, file.objectKey)
      if (!head) throw new AppError('FILE_NOT_READY', 422, 'The upload has not finished yet.')
      // CSVs are text: a NUL byte in the first KB means a binary file (e.g. a renamed .xlsx).
      const ok =
        head.size === Number(file.sizeBytes) &&
        !(await this.storage.getBytes(file.bucket, file.objectKey, 'bytes=0-1023')).includes(0)
      await this.tenantDb.run((tx) =>
        tx.file.update({ where: { id: fileId }, data: { status: ok ? 'READY' : 'REJECTED' } }),
      )
      if (!ok)
        throw AppError.validation([
          { path: 'fileId', code: 'invalid_file', message: 'This file is not a readable CSV.' },
        ])
    } else if (file.status !== 'READY')
      throw new AppError('FILE_NOT_READY', 422, 'This file was rejected.')
    const job = await this.tenantDb.run(async (tx) => {
      const created = await tx.importJob.create({
        data: { tenantId, fileId, createdBy: currentAuth().userId },
        include: { file: true },
      })
      await this.audit.write(tx, {
        action: 'contacts.import_started',
        targetType: 'import_job',
        targetId: created.id,
        changes: { filename: file.filename },
      })
      return created
    })
    await this.enqueue(IMPORT_STEPS.analyze, tenantId, job.id)
    return toImportJob(job)
  }

  async configure(id: string, input: ConfigureImportRequest): Promise<ImportJob> {
    const { tenantId } = currentTenant()
    const job = await this.tenantDb.run(async (tx) => {
      const job = await this.find(tx, id)
      if (!['MAPPING', 'PREVIEW_READY'].includes(job.status))
        throw new AppError('IMPORT_NOT_READY', 409, 'This import can no longer be changed.')
      const headers = (job.headers as string[] | null) ?? []
      const errors: Array<{ path: string; code: string; message: string }> = []
      const targets = Object.entries(input.columnMapping)
      for (const [header] of targets)
        if (!headers.includes(header))
          errors.push({
            path: `columnMapping.${header}`,
            code: 'unknown_column',
            message: `The file has no column "${header}".`,
          })
      const used = targets.map(([, t]) => t).filter((t) => t !== 'ignore')
      if (!used.includes('phone'))
        errors.push({
          path: 'columnMapping',
          code: 'phone_required',
          message: 'Map one column to Phone.',
        })
      const dupes = used.filter((t, i) => used.indexOf(t) !== i)
      if (dupes.length)
        errors.push({
          path: 'columnMapping',
          code: 'duplicate_target',
          message: `Map each field once (${[...new Set(dupes)].join(', ')}).`,
        })
      const keys = used.filter((t) => t.startsWith('property.')).map((t) => t.slice(9))
      if (keys.length) {
        const defs = await tx.contactPropertyDefinition.findMany({
          where: { key: { in: keys }, archivedAt: null },
        })
        for (const k of keys)
          if (!defs.some((d) => d.key === k))
            errors.push({
              path: 'columnMapping',
              code: 'unknown_property',
              message: `There is no property "${k}".`,
            })
      }
      if (errors.length) throw AppError.validation(errors)
      return tx.importJob.update({
        where: { id },
        data: {
          columnMapping: input.columnMapping,
          duplicatePolicy: input.duplicatePolicy,
          defaultConsent: input.defaultConsent ?? undefined,
          suppressAutomations: input.suppressAutomations,
          status: 'VALIDATING',
          preview: undefined,
        },
        include: { file: true },
      })
    })
    await this.enqueue(IMPORT_STEPS.validate, tenantId, id, Date.now())
    return toImportJob(job)
  }

  async confirm(id: string): Promise<ImportJob> {
    const { tenantId } = currentTenant()
    const job = await this.tenantDb.run(async (tx) => {
      const job = await this.find(tx, id)
      if (job.status !== 'PREVIEW_READY')
        throw new AppError('IMPORT_NOT_READY', 409, 'Review the preview before importing.')
      // The projected total (existing + the preview's new rows) must fit the plan's contact limit.
      await this.entitlements.assertWithin(tx, tenantId, 'max_contacts', job.newRows)
      return tx.importJob.update({
        where: { id },
        data: { status: 'IMPORTING', startedAt: new Date() },
        include: { file: true },
      })
    })
    await this.enqueue(IMPORT_STEPS.run, tenantId, id)
    return toImportJob(job)
  }

  /** Stops an import between batches; rows already committed stay. */
  async cancel(id: string): Promise<ImportJob> {
    return this.tenantDb.run(async (tx) => {
      const job = await this.find(tx, id)
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status))
        throw new AppError('CONFLICT', 409, 'This import has already finished.')
      return toImportJob(
        await tx.importJob.update({
          where: { id },
          data: { status: 'CANCELLED', completedAt: new Date() },
          include: { file: true },
        }),
      )
    })
  }

  async errorReportUrl(id: string): Promise<{ url: string; expiresAt: string }> {
    const file = await this.tenantDb.run(async (tx) => {
      const job = await this.find(tx, id)
      return job.errorFileId ? tx.file.findFirst({ where: { id: job.errorFileId } }) : null
    })
    if (!file) throw AppError.notFound('This import has no error report.')
    return {
      url: await this.storage.presignGet(
        file.bucket,
        file.objectKey,
        300,
        file.filename ?? 'import-errors.csv',
      ),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }
  }

  private async find(tx: Parameters<Parameters<TenantDb['run']>[0]>[0], id: string) {
    const job = await tx.importJob.findFirst({ where: { id }, include: { file: true } })
    if (!job) throw AppError.notFound('Import not found.')
    return job
  }

  private enqueue(
    step: string,
    tenantId: string,
    importJobId: string,
    attempt: number | string = 0,
  ) {
    const data: ImportJobData = { tenantId, importJobId }
    return this.queues.get(QUEUES.contactsImport).add(step, data, {
      jobId: jobId('import', importJobId, step, attempt),
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    })
  }
}
