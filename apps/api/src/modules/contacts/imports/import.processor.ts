import { uuidv7 } from '@fenwira/config'
import { type ImportTarget, MAX_IMPORT_ROWS } from '@fenwira/contracts'
import { Database, Prisma, type TenantTx } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../../core/queue/queue-processor'
import { RealtimeEmitter } from '../../../core/realtime/realtime-emitter'
import { StorageService } from '../../../core/storage/storage.service'
import { recordConsent } from '../consent'
import { type DefinitionRow } from '../properties'
import { type CsvRow, headersOf, readCsv, toCsv } from './csv'
import { IMPORT_STEPS, type ImportJobData } from './imports.service'
import { type RowError, RowValidator, suggestMapping, type ValidRow } from './row-validator'

const BATCH = 1000
const PREVIEW_ROWS = 50
const TX = { timeoutMs: 120_000 }

type Loaded = Awaited<ReturnType<ImportProcessor['load']>>
type Checked = { row: number; record: Record<string, string>; errors: RowError[]; valid?: ValidRow }

/**
 * contacts.import (docs/CONTACTS_AND_CONSENT.md → CSV import). Streams the file from MinIO for
 * each step, so memory stays flat up to the 100k-row limit. Duplicates: the first row for a phone
 * wins; later rows for the same phone are DUPLICATE_IN_FILE errors. Existing contacts follow the
 * job's policy (SKIP or UPDATE).
 */
@Injectable()
export class ImportProcessor implements QueueProcessor<ImportJobData> {
  readonly queue = QUEUES.contactsImport
  readonly concurrency = 2

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeEmitter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('ImportProcessor')
  }

  async process(job: Job<ImportJobData>): Promise<string> {
    const { tenantId, importJobId } = job.data
    try {
      if (job.name === IMPORT_STEPS.analyze) return await this.analyze(tenantId, importJobId)
      if (job.name === IMPORT_STEPS.validate) return await this.validate(tenantId, importJobId)
      return await this.run(tenantId, importJobId)
    } catch (err) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.update(tenantId, importJobId, {
          status: 'FAILED',
          failureReason: err instanceof Error ? err.message.slice(0, 500) : String(err),
          completedAt: new Date(),
        })
        this.logger.error({ importJobId, err }, 'import failed')
      }
      throw err
    }
  }

  // ------------------------------------------------------------------------------ analyze

  private async analyze(tenantId: string, id: string): Promise<string> {
    const { job } = await this.load(tenantId, id)
    if (job.status !== 'UPLOADED') return 'skipped'
    const sample: Record<string, string>[] = []
    let headers: string[] = []
    let total = 0
    for await (const { record } of await this.rows(job.file)) {
      if (!total) headers = headersOf(record)
      if (sample.length < PREVIEW_ROWS) sample.push(record)
      total += 1
      if (total > MAX_IMPORT_ROWS) break
    }
    if (total > MAX_IMPORT_ROWS || total === 0) {
      await this.update(tenantId, id, {
        status: 'FAILED',
        failureReason: total
          ? `The file has more than ${MAX_IMPORT_ROWS} rows.`
          : 'The file has no data rows.',
        completedAt: new Date(),
      })
      return 'rejected'
    }
    const defs = await this.definitions(tenantId)
    await this.update(tenantId, id, {
      status: 'MAPPING',
      headers,
      sample,
      suggestedMapping: suggestMapping(headers, defs),
      totalRows: total,
    })
    return 'analyzed'
  }

  // ------------------------------------------------------------------------------ validate

  private async validate(tenantId: string, id: string): Promise<string> {
    const ctx = await this.load(tenantId, id)
    if (ctx.job.status !== 'VALIDATING') return 'skipped'
    await this.db.withTenant(tenantId, (tx) =>
      tx.importJobError.deleteMany({ where: { importJobId: id } }),
    )
    const counts = { valid: 0, invalid: 0, new: 0, existing: 0 }
    const preview: Array<{ row: number; values: Record<string, string>; errors: RowError[] }> = []
    for await (const batch of this.checkedBatches(ctx)) {
      const existing = await this.existingPhones(tenantId, batch)
      await this.saveErrors(tenantId, id, batch)
      for (const r of batch) {
        if (preview.length < PREVIEW_ROWS)
          preview.push({ row: r.row, values: r.record, errors: r.errors.map((e) => ({ ...e })) })
        if (!r.valid) counts.invalid += 1
        else {
          counts.valid += 1
          if (existing.has(r.valid.phoneE164)) counts.existing += 1
          else counts.new += 1
        }
      }
    }
    await this.update(tenantId, id, {
      status: 'PREVIEW_READY',
      validRows: counts.valid,
      invalidRows: counts.invalid,
      newRows: counts.new,
      existingRows: counts.existing,
      preview: preview.map((p) => ({ ...p, errors: p.errors.map((e) => ({ row: p.row, ...e })) })),
    })
    return 'validated'
  }

  // ------------------------------------------------------------------------------ import

  private async run(tenantId: string, id: string): Promise<string> {
    const ctx = await this.load(tenantId, id)
    if (ctx.job.status !== 'IMPORTING') return 'skipped'
    await this.db.withTenant(tenantId, (tx) =>
      tx.importJobError.deleteMany({ where: { importJobId: id } }),
    )
    const totals = { processed: 0, created: 0, updated: 0, skipped: 0, valid: 0, invalid: 0 }
    const errorRows = new Set<number>()
    for await (const batch of this.checkedBatches(ctx)) {
      const current = await this.db.withTenant(tenantId, (tx) =>
        tx.importJob.findFirstOrThrow({ where: { id }, select: { status: true } }),
      )
      if (current.status === 'CANCELLED') {
        await this.writeErrorReport(ctx, errorRows)
        return 'cancelled'
      }
      await this.saveErrors(tenantId, id, batch)
      for (const r of batch) if (r.errors.length) errorRows.add(r.row)
      const valid = batch.filter((r): r is Checked & { valid: ValidRow } => !!r.valid)
      const result = await this.db.withTenant(tenantId, (tx) => this.applyBatch(tx, ctx, valid), TX)
      totals.processed += batch.length
      totals.valid += valid.length
      totals.invalid += batch.length - valid.length
      totals.created += result.created
      totals.updated += result.updated
      totals.skipped += result.skipped
      await this.update(tenantId, id, {
        processedRows: totals.processed,
        createdCount: totals.created,
        updatedCount: totals.updated,
        skippedCount: totals.skipped,
      })
      this.realtime.toTenant(tenantId, 'import.progress', {
        importJobId: id,
        processed: totals.processed,
        total: ctx.job.totalRows,
      })
    }
    const errorFileId = await this.writeErrorReport(ctx, errorRows)
    await this.update(tenantId, id, {
      status: 'COMPLETED',
      completedAt: new Date(),
      validRows: totals.valid,
      invalidRows: totals.invalid,
      errorFileId,
    })
    this.realtime.toTenant(tenantId, 'import.progress', {
      importJobId: id,
      processed: totals.processed,
      total: ctx.job.totalRows,
      status: 'COMPLETED',
    })
    return 'imported'
  }

  private async applyBatch(tx: TenantTx, ctx: Loaded, rows: Array<Checked & { valid: ValidRow }>) {
    const { tenantId, job } = ctx
    const out = { created: 0, updated: 0, skipped: 0 }
    if (!rows.length) return out
    const existingRows = await tx.contact.findMany({
      where: { phoneE164: { in: rows.map((r) => r.valid.phoneE164) }, deletedAt: null },
      select: { id: true, phoneE164: true, marketingConsent: true },
    })
    const existing = new Map(existingRows.map((c) => [c.phoneE164, c]))
    const tagIds = await this.ensureTags(
      tx,
      tenantId,
      rows.flatMap((r) => r.valid.tags),
    )
    const evidence = (row: number) => ({ importJobId: job.id, row })
    const now = new Date()

    const fresh = rows.filter((r) => !existing.has(r.valid.phoneE164))
    const created = fresh.map((r) => ({ ...r, id: uuidv7() }))
    if (created.length) {
      await tx.contact.createMany({
        data: created.map((r) => ({
          id: r.id,
          tenantId,
          phoneE164: r.valid.phoneE164,
          name: r.valid.name ?? null,
          email: r.valid.email ?? null,
          language: r.valid.language ?? null,
          country: r.valid.country ?? null,
          source: 'IMPORT' as const,
          marketingConsent: r.valid.consent ?? 'NONE',
        })),
      })
      const values = created.flatMap((r) =>
        r.valid.properties.map((p) => ({
          tenantId,
          contactId: r.id,
          definitionId: p.definitionId,
          ...p.value,
        })),
      )
      if (values.length) await tx.contactPropertyValue.createMany({ data: values })
      const withConsent = created.filter((r) => r.valid.consent)
      if (withConsent.length) {
        await tx.consent.createMany({
          data: withConsent.map((r) => ({
            tenantId,
            contactId: r.id,
            purpose: 'MARKETING' as const,
            status: r.valid.consent!,
            source: 'IMPORT' as const,
            capturedAt: now,
            evidence: evidence(r.row),
          })),
        })
        await tx.outboxEvent.createMany({
          data: withConsent.map((r) => ({
            tenantId,
            eventType: 'consent.changed',
            aggregateType: 'contact',
            aggregateId: r.id,
            payload: {
              contactId: r.id,
              purpose: 'MARKETING',
              status: r.valid.consent!,
              source: 'IMPORT',
            },
          })),
        })
      }
      // Automations triggered by "contact created" are suppressed for imports by default.
      if (!job.suppressAutomations)
        await tx.outboxEvent.createMany({
          data: created.map((r) => ({
            tenantId,
            eventType: 'contact.created',
            aggregateType: 'contact',
            aggregateId: r.id,
            payload: { contactId: r.id, source: 'IMPORT' },
          })),
        })
      out.created = created.length
    }

    const updates = rows.filter((r) => existing.has(r.valid.phoneE164))
    if (job.duplicatePolicy === 'SKIP') out.skipped = updates.length
    else
      for (const r of updates) {
        const contactId = existing.get(r.valid.phoneE164)!.id
        const v = r.valid
        await tx.contact.update({
          where: { id: contactId },
          data: {
            ...(v.name ? { name: v.name } : {}),
            ...(v.email ? { email: v.email } : {}),
            ...(v.language ? { language: v.language } : {}),
            ...(v.country ? { country: v.country } : {}),
          },
        })
        for (const p of v.properties)
          await tx.contactPropertyValue.upsert({
            where: { contactId_definitionId: { contactId, definitionId: p.definitionId } },
            create: { tenantId, contactId, definitionId: p.definitionId, ...p.value },
            update: p.value,
          })
        if (v.consent)
          await recordConsent(tx, {
            tenantId,
            contactId,
            purpose: 'MARKETING',
            status: v.consent,
            source: 'IMPORT',
            evidence: evidence(r.row),
            actorId: job.createdBy,
          })
        out.updated += 1
      }

    // Tags and the timeline for every contact this batch touched.
    const touched = [
      ...created.map((r) => ({ id: r.id, row: r })),
      ...(job.duplicatePolicy === 'UPDATE'
        ? updates.map((r) => ({ id: existing.get(r.valid.phoneE164)!.id, row: r }))
        : []),
    ]
    const tagLinks = touched.flatMap(({ id, row }) =>
      row.valid.tags.map((t) => ({
        tenantId,
        contactId: id,
        tagId: tagIds.get(t.toLowerCase())!,
        createdBy: job.createdBy,
      })),
    )
    if (tagLinks.length) await tx.contactTag.createMany({ data: tagLinks, skipDuplicates: true })
    if (touched.length)
      await tx.contactActivity.createMany({
        data: touched.map(({ id, row }) => ({
          tenantId,
          contactId: id,
          type: 'contact.imported',
          actorType: 'USER' as const,
          actorId: job.createdBy,
          data: {
            importJobId: job.id,
            row: row.row,
            ...(row.valid.consent ? { consent: row.valid.consent } : {}),
          },
          occurredAt: now,
        })),
      })
    return out
  }

  /** Tag names → ids (case-insensitive); missing tags are created. */
  private async ensureTags(
    tx: TenantTx,
    tenantId: string,
    names: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()]
    const map = new Map<string, string>()
    if (!unique.length) return map
    await tx.tag.createMany({
      data: unique.map((name) => ({ tenantId, name })),
      skipDuplicates: true,
    })
    const tags = await tx.tag.findMany({ where: { name: { in: unique } } })
    for (const t of tags) map.set(t.name.toLowerCase(), t.id)
    return map
  }

  // ------------------------------------------------------------------------------ shared

  /** Validated rows in batches, with in-file duplicate detection (first occurrence wins). */
  private async *checkedBatches(ctx: Loaded): AsyncGenerator<Checked[]> {
    const mapping = (ctx.job.columnMapping as Record<string, ImportTarget> | null) ?? {}
    const consent = (ctx.job.defaultConsent as { marketing?: 'GRANTED' | 'REVOKED' } | null)
      ?.marketing
    const validator = new RowValidator(mapping, ctx.definitions, ctx.defaultCountry, consent)
    const seen = new Map<string, number>()
    let batch: Checked[] = []
    for await (const { row, record } of await this.rows(ctx.job.file)) {
      const result = validator.validate(record)
      const checked: Checked = { row, record, errors: result.errors, valid: result.row }
      if (result.row) {
        const first = seen.get(result.row.phoneE164)
        if (first !== undefined) {
          checked.valid = undefined
          checked.errors = [
            { field: null, code: 'DUPLICATE_IN_FILE', message: `Same phone as row ${first}.` },
          ]
        } else seen.set(result.row.phoneE164, row)
      }
      batch.push(checked)
      if (batch.length === BATCH) {
        yield batch
        batch = []
      }
    }
    if (batch.length) yield batch
  }

  private async existingPhones(tenantId: string, batch: Checked[]): Promise<Set<string>> {
    const phones = batch.flatMap((r) => (r.valid ? [r.valid.phoneE164] : []))
    if (!phones.length) return new Set()
    const rows = await this.db.withTenant(tenantId, (tx) =>
      tx.contact.findMany({
        where: { phoneE164: { in: phones }, deletedAt: null },
        select: { phoneE164: true },
      }),
    )
    return new Set(rows.map((r) => r.phoneE164))
  }

  private async saveErrors(tenantId: string, importJobId: string, batch: Checked[]): Promise<void> {
    const data = batch.flatMap((r) =>
      r.errors.map((e) => ({
        tenantId,
        importJobId,
        rowNumber: r.row,
        field: e.field,
        code: e.code,
        message: e.message,
      })),
    )
    if (data.length)
      await this.db.withTenant(tenantId, (tx) => tx.importJobError.createMany({ data }))
  }

  /** Original row + error columns, for rows that failed. Returns the file id (or null). */
  private async writeErrorReport(ctx: Loaded, errorRows: Set<number>): Promise<string | null> {
    if (!errorRows.size) return null
    const { tenantId, job } = ctx
    const errors = await this.db.withTenant(tenantId, (tx) =>
      tx.importJobError.findMany({
        where: { importJobId: job.id },
        orderBy: [{ rowNumber: 'asc' }],
      }),
    )
    const byRow = new Map<number, typeof errors>()
    for (const e of errors) byRow.set(e.rowNumber, [...(byRow.get(e.rowNumber) ?? []), e])
    const headers = (job.headers as string[] | null) ?? []
    const out: Array<Record<string, unknown>> = []
    for await (const { row, record } of await this.rows(job.file)) {
      const rowErrors = byRow.get(row)
      if (!rowErrors) continue
      out.push({
        ...record,
        error_row: row,
        error_field: rowErrors.map((e) => e.field ?? '').join('; '),
        error_code: rowErrors.map((e) => e.code).join('; '),
        error_message: rowErrors.map((e) => e.message).join('; '),
      })
    }
    const csv = toCsv(out, [...headers, 'error_row', 'error_field', 'error_code', 'error_message'])
    const fileId = uuidv7()
    const key = `${tenantId}/imports/${job.id}-errors.csv`
    await this.storage.put(this.storage.importsBucket, key, Buffer.from(csv, 'utf8'), 'text/csv')
    await this.db.withTenant(tenantId, (tx) =>
      tx.file.create({
        data: {
          id: fileId,
          tenantId,
          bucket: this.storage.importsBucket,
          objectKey: key,
          mimeType: 'text/csv',
          sizeBytes: Buffer.byteLength(csv),
          filename: `${(job.file.filename ?? 'import').replace(/\.csv$/i, '')}-errors.csv`,
          purpose: 'IMPORT',
          status: 'READY',
          uploadedBy: job.createdBy,
        },
      }),
    )
    return fileId
  }

  private async rows(file: { bucket: string; objectKey: string }): Promise<AsyncGenerator<CsvRow>> {
    return readCsv(await this.storage.getStream(file.bucket, file.objectKey))
  }

  private async load(tenantId: string, id: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const job = await tx.importJob.findFirstOrThrow({ where: { id }, include: { file: true } })
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { defaultCountry: true },
      })
      const definitions = (await tx.contactPropertyDefinition.findMany({
        where: { archivedAt: null },
      })) as DefinitionRow[]
      return { tenantId, job, defaultCountry: tenant.defaultCountry, definitions }
    })
  }

  private definitions(tenantId: string): Promise<DefinitionRow[]> {
    return this.db.withTenant(tenantId, (tx) =>
      tx.contactPropertyDefinition.findMany({ where: { archivedAt: null } }),
    ) as Promise<DefinitionRow[]>
  }

  private update(tenantId: string, id: string, data: Prisma.ImportJobUpdateInput) {
    return this.db.withTenant(tenantId, (tx) => tx.importJob.update({ where: { id }, data }))
  }
}
