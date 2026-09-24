import { uuidv7 } from '@fenwira/config'
import { type ContactFilter, type ExportJob } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { jobId, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { StorageService } from '../../core/storage/storage.service'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { FilterCompiler } from './filter/compile'
import { toCsv } from './imports/csv'
import { propertyOut } from './properties'

const PAGE = 1000
const TTL_MS = 7 * 24 * 3600 * 1000
type ExportJobData = { tenantId: string; exportJobId: string; q?: string }

type ExportRow = {
  id: string
  status: ExportJob['status']
  rowCount: number | null
  fileId: string | null
  expiresAt: Date
  createdAt: Date
}

/** POST /exports → contacts.export job → CSV in fenwira-exports; download link valid 5 min. */
@Injectable()
export class ExportsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly queues: QueueRegistry,
    private readonly storage: StorageService,
  ) {}

  async create(filter: ContactFilter | undefined, q?: string): Promise<ExportJob> {
    const { tenantId } = currentTenant()
    const row = await this.tenantDb.run(async (tx) => {
      await new FilterCompiler(tx).compile(filter, q) // reject an invalid filter now, not in the job
      return tx.exportJob.create({
        data: {
          tenantId,
          createdBy: currentAuth().userId,
          filter: (filter ?? { op: 'AND', rules: [] }) as object,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      })
    })
    const data: ExportJobData = { tenantId, exportJobId: row.id, q }
    await this.queues.get(QUEUES.contactsExport).add('export', data, {
      jobId: jobId('export', row.id),
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    })
    return this.dto(row)
  }

  async get(id: string): Promise<ExportJob> {
    const row = await this.tenantDb.run((tx) => tx.exportJob.findFirst({ where: { id } }))
    if (!row) throw AppError.notFound('Export not found.')
    return this.dto(row)
  }

  private async dto(row: ExportRow): Promise<ExportJob> {
    const expired = row.expiresAt < new Date()
    let downloadUrl: string | null = null
    if (row.status === 'COMPLETED' && row.fileId && !expired) {
      const file = await this.tenantDb.run((tx) =>
        tx.file.findFirst({ where: { id: row.fileId! } }),
      )
      if (file)
        downloadUrl = await this.storage.presignGet(
          file.bucket,
          file.objectKey,
          300,
          file.filename ?? 'contacts.csv',
        )
    }
    return {
      id: row.id,
      status: expired && row.status === 'COMPLETED' ? 'EXPIRED' : row.status,
      rowCount: row.rowCount,
      downloadUrl,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }
  }
}

@Injectable()
export class ExportProcessor implements QueueProcessor<ExportJobData> {
  readonly queue = QUEUES.contactsExport
  readonly concurrency = 2

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async process(job: Job<ExportJobData>): Promise<string> {
    const { tenantId, exportJobId, q } = job.data
    const exp = await this.db.withTenant(tenantId, async (tx) => {
      const e = await tx.exportJob.findFirst({ where: { id: exportJobId } })
      if (!e || e.status === 'COMPLETED') return null
      await tx.exportJob.update({ where: { id: e.id }, data: { status: 'RUNNING' } })
      return e
    })
    if (!exp) return 'skipped'
    try {
      const { csv, rows } = await this.build(tenantId, exp.filter as unknown as ContactFilter, q)
      const fileId = uuidv7()
      const key = `${tenantId}/exports/${exp.id}.csv`
      const filename = `contacts-${exp.createdAt.toISOString().slice(0, 10)}.csv`
      await this.storage.put(this.storage.exportsBucket, key, Buffer.from(csv, 'utf8'), 'text/csv')
      await this.db.withTenant(tenantId, async (tx) => {
        await tx.file.create({
          data: {
            id: fileId,
            tenantId,
            bucket: this.storage.exportsBucket,
            objectKey: key,
            mimeType: 'text/csv',
            sizeBytes: Buffer.byteLength(csv),
            filename,
            purpose: 'EXPORT',
            status: 'READY',
            uploadedBy: exp.createdBy,
          },
        })
        await tx.exportJob.update({
          where: { id: exp.id },
          data: { status: 'COMPLETED', fileId, rowCount: rows },
        })
        await this.audit.write(tx, {
          tenantId,
          actorId: exp.createdBy,
          action: 'contacts.exported',
          targetType: 'export_job',
          targetId: exp.id,
          changes: { filter: exp.filter, q: q ?? null, rows },
        })
      })
      this.realtime.toTenant(tenantId, 'export.completed', { exportJobId: exp.id, rows })
      return 'exported'
    } catch (err) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1))
        await this.db.withTenant(tenantId, (tx) =>
          tx.exportJob.update({ where: { id: exp.id }, data: { status: 'FAILED' } }),
        )
      throw err
    }
  }

  /** Core fields, tags, current consent per purpose, and every active property. */
  private async build(tenantId: string, filter: ContactFilter, q?: string) {
    const defs = await this.db.withTenant(tenantId, (tx) =>
      tx.contactPropertyDefinition.findMany({
        where: { archivedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    )
    const columns = [
      'phone',
      'name',
      'email',
      'language',
      'country',
      'source',
      'status',
      'tags',
      'marketing_consent',
      'utility_consent',
      'created_at',
      ...defs.map((d) => d.key),
    ]
    const out: Array<Record<string, unknown>> = []
    let cursor: string | undefined
    for (;;) {
      const page = await this.db.withTenant(
        tenantId,
        async (tx) => {
          const where = await new FilterCompiler(tx).compile(filter, q)
          return tx.contact.findMany({
            where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
            include: {
              tags: { include: { tag: true } },
              propertyValues: { include: { definition: true } },
            },
            orderBy: { id: 'asc' },
            take: PAGE,
          })
        },
        { timeoutMs: 60_000 },
      )
      for (const c of page) {
        const props: Record<string, unknown> = {}
        for (const v of c.propertyValues)
          props[v.definition.key] = propertyOut(v.definition.type, v) ?? ''
        out.push({
          phone: c.phoneE164,
          name: c.name,
          email: c.email,
          language: c.language,
          country: c.country,
          source: c.source,
          status: c.status,
          tags: c.tags.map((t) => t.tag.name).join('; '),
          marketing_consent: c.marketingConsent,
          utility_consent: c.utilityConsent,
          created_at: c.createdAt.toISOString(),
          ...props,
        })
      }
      if (page.length < PAGE) break
      cursor = page[page.length - 1]!.id
    }
    return { csv: toCsv(out, columns), rows: out.length }
  }
}
