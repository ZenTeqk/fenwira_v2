import {
  type ConsentSettings,
  type ContactFilter,
  MAX_PROPERTY_DEFINITIONS,
  type PropertyDefinition,
  type Segment,
  type TagColor,
} from '@fenwira/contracts'
import { Prisma } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { FilterCompiler } from './filter/compile'

const isUnique = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
const iso = (d: Date | null) => d?.toISOString() ?? null

type DefinitionRow = {
  id: string
  key: string
  label: string
  type: PropertyDefinition['type']
  options: Prisma.JsonValue
  required: boolean
  archivedAt: Date | null
  createdAt: Date
}
const toDefinition = (d: DefinitionRow): PropertyDefinition => ({
  id: d.id,
  key: d.key,
  label: d.label,
  type: d.type,
  options: (d.options as string[] | null) ?? null,
  required: d.required,
  archived: !!d.archivedAt,
  createdAt: d.createdAt.toISOString(),
})

type SegmentRow = {
  id: string
  name: string
  filter: Prisma.JsonValue
  cachedCount: number | null
  cachedCountAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toSegment = (s: SegmentRow): Segment => ({
  id: s.id,
  name: s.name,
  filter: s.filter as unknown as ContactFilter,
  cachedCount: s.cachedCount,
  cachedCountAt: iso(s.cachedCountAt),
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
})

/** Tags, custom property definitions, segments and consent keyword settings. */
@Injectable()
export class ContactCatalogService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------- tags

  listTags() {
    return this.tenantDb.run(async (tx) => {
      const tags = await tx.tag.findMany({ orderBy: { name: 'asc' } })
      const counts = await tx.contactTag.groupBy({
        by: ['tagId'],
        where: { contact: { deletedAt: null } },
        _count: { _all: true },
      })
      const byTag = new Map(counts.map((c) => [c.tagId, c._count._all]))
      return tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        contactCount: byTag.get(t.id) ?? 0,
      }))
    })
  }

  async createTag(input: { name: string; color: TagColor }) {
    const { tenantId } = currentTenant()
    try {
      const t = await this.tenantDb.run((tx) => tx.tag.create({ data: { tenantId, ...input } }))
      return { id: t.id, name: t.name, color: t.color }
    } catch (err) {
      if (isUnique(err)) throw new AppError('CONFLICT', 409, 'A tag with this name already exists.')
      throw err
    }
  }

  async updateTag(id: string, input: { name?: string; color?: TagColor }) {
    try {
      const t = await this.tenantDb.run(async (tx) => {
        if (!(await tx.tag.findFirst({ where: { id } }))) throw AppError.notFound('Tag not found.')
        return tx.tag.update({ where: { id }, data: input })
      })
      return { id: t.id, name: t.name, color: t.color }
    } catch (err) {
      if (isUnique(err)) throw new AppError('CONFLICT', 409, 'A tag with this name already exists.')
      throw err
    }
  }

  async deleteTag(id: string): Promise<void> {
    await this.tenantDb.run(async (tx) => {
      const tag = await tx.tag.findFirst({ where: { id } })
      if (!tag) throw AppError.notFound('Tag not found.')
      await tx.tag.delete({ where: { id } })
      await this.audit.write(tx, {
        action: 'tag.deleted',
        targetType: 'tag',
        targetId: id,
        changes: { name: tag.name },
      })
    })
  }

  // ---------------------------------------------------------------------------- properties

  async listProperties(): Promise<PropertyDefinition[]> {
    const rows = await this.tenantDb.run((tx) =>
      tx.contactPropertyDefinition.findMany({ orderBy: { createdAt: 'asc' } }),
    )
    return rows.map(toDefinition)
  }

  async createProperty(input: {
    key: string
    label: string
    type: PropertyDefinition['type']
    options?: string[]
    required: boolean
  }): Promise<PropertyDefinition> {
    const { tenantId } = currentTenant()
    try {
      return await this.tenantDb.run(async (tx) => {
        const active = await tx.contactPropertyDefinition.count({ where: { archivedAt: null } })
        if (active >= MAX_PROPERTY_DEFINITIONS)
          throw new AppError(
            'LIMIT_EXCEEDED',
            422,
            `A workspace can have ${MAX_PROPERTY_DEFINITIONS} active properties.`,
          )
        const def = await tx.contactPropertyDefinition.create({
          data: { tenantId, ...input, options: input.options ?? Prisma.DbNull },
        })
        await this.audit.write(tx, {
          action: 'contact_property.created',
          targetType: 'contact_property',
          targetId: def.id,
          changes: { key: def.key, type: def.type },
        })
        return toDefinition(def)
      })
    } catch (err) {
      if (isUnique(err))
        throw new AppError('CONFLICT', 409, 'A property with this key already exists.')
      throw err
    }
  }

  async updateProperty(
    id: string,
    input: { label?: string; options?: string[]; required?: boolean; archived?: boolean },
  ): Promise<PropertyDefinition> {
    return this.tenantDb.run(async (tx) => {
      const def = await tx.contactPropertyDefinition.findFirst({ where: { id } })
      if (!def) throw AppError.notFound('Property not found.')
      if (input.options && def.type !== 'SELECT')
        throw AppError.validation([
          { path: 'options', code: 'invalid', message: 'Only SELECT properties have options.' },
        ])
      const updated = await tx.contactPropertyDefinition.update({
        where: { id },
        data: {
          label: input.label,
          options: input.options,
          required: input.required,
          ...(input.archived === undefined
            ? {}
            : { archivedAt: input.archived ? new Date() : null }),
        },
      })
      await this.audit.write(tx, {
        action: 'contact_property.updated',
        targetType: 'contact_property',
        targetId: id,
        changes: input,
      })
      return toDefinition(updated)
    })
  }

  // ---------------------------------------------------------------------------- segments

  async listSegments(): Promise<Segment[]> {
    const rows = await this.tenantDb.run((tx) =>
      tx.segment.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } }),
    )
    return rows.map(toSegment)
  }

  async getSegment(id: string): Promise<Segment> {
    return toSegment(await this.tenantDb.run((tx) => this.findSegment(tx, id)))
  }

  async createSegment(input: { name: string; filter: ContactFilter }): Promise<Segment> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      // Compiling validates property keys and referenced segments up front.
      const count = await tx.contact.count({
        where: await new FilterCompiler(tx).compile(input.filter),
      })
      const s = await tx.segment.create({
        data: {
          tenantId,
          name: input.name,
          filter: input.filter as unknown as Prisma.InputJsonValue,
          createdBy: currentAuth().userId,
          cachedCount: count,
          cachedCountAt: new Date(),
        },
      })
      return toSegment(s)
    })
  }

  async updateSegment(
    id: string,
    input: { name?: string; filter?: ContactFilter },
  ): Promise<Segment> {
    return this.tenantDb.run(async (tx) => {
      await this.findSegment(tx, id)
      const count = input.filter
        ? await tx.contact.count({ where: await new FilterCompiler(tx).compile(input.filter) })
        : undefined
      const s = await tx.segment.update({
        where: { id },
        data: {
          name: input.name,
          ...(input.filter
            ? {
                filter: input.filter as unknown as Prisma.InputJsonValue,
                cachedCount: count,
                cachedCountAt: new Date(),
              }
            : {}),
        },
      })
      return toSegment(s)
    })
  }

  async deleteSegment(id: string): Promise<void> {
    await this.tenantDb.run(async (tx) => {
      await this.findSegment(tx, id)
      await tx.segment.update({ where: { id }, data: { deletedAt: new Date() } })
    })
  }

  /** Live count; also refreshes the cached "≈" count shown in lists. */
  async countSegment(id: string): Promise<{ count: number; countedAt: string }> {
    return this.tenantDb.run(async (tx) => {
      const s = await this.findSegment(tx, id)
      const count = await tx.contact.count({
        where: await new FilterCompiler(tx).compile(s.filter as unknown as ContactFilter),
      })
      const now = new Date()
      await tx.segment.update({ where: { id }, data: { cachedCount: count, cachedCountAt: now } })
      return { count, countedAt: now.toISOString() }
    })
  }

  private async findSegment(tx: Parameters<Parameters<TenantDb['run']>[0]>[0], id: string) {
    const s = await tx.segment.findFirst({ where: { id, deletedAt: null } })
    if (!s) throw AppError.notFound('Segment not found.')
    return s
  }

  // ---------------------------------------------------------------------------- consent keywords

  async consentSettings(): Promise<ConsentSettings> {
    const { tenantId } = currentTenant()
    const t = await this.tenantDb.run((tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { optOutKeywords: true, optInKeywords: true, optOutReply: true },
      }),
    )
    return t
  }

  async updateConsentSettings(input: Partial<ConsentSettings>): Promise<ConsentSettings> {
    const { tenantId } = currentTenant()
    const norm = (list?: string[]) =>
      list ? [...new Set(list.map((k) => k.trim().toUpperCase()).filter(Boolean))] : undefined
    const optOut = norm(input.optOutKeywords)
    const optIn = norm(input.optInKeywords)
    const overlap = optOut && optIn ? optOut.filter((k) => optIn.includes(k)) : []
    if (overlap.length)
      throw AppError.validation([
        {
          path: 'optInKeywords',
          code: 'overlap',
          message: `A keyword can't opt in and out: ${overlap.join(', ')}.`,
        },
      ])
    return this.tenantDb.run(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          optOutKeywords: optOut,
          optInKeywords: optIn,
          ...(input.optOutReply === undefined ? {} : { optOutReply: input.optOutReply || null }),
        },
        select: { optOutKeywords: true, optInKeywords: true, optOutReply: true },
      })
      await this.audit.write(tx, {
        action: 'workspace.consent_settings_updated',
        targetType: 'workspace',
        targetId: tenantId,
        changes: input,
      })
      return t
    })
  }
}
