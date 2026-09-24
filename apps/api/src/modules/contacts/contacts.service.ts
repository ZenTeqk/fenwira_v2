import {
  type BulkContactsRequest,
  type Contact,
  type ContactActivity,
  type ContactFilter,
  type ContactNote,
  type ConsentRecord,
  type CreateContactRequest,
  type SearchContactsRequest,
  type UpdateContactRequest,
} from '@fenwira/contracts'
import { Prisma, type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { normalizePhone } from '../../core/phone'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { addActivity, recordConsent } from './consent'
import { CONTACT_INCLUDE, toContact } from './contacts.mapper'
import { FilterCompiler } from './filter/compile'
import { coercePropertyValue, type DefinitionRow } from './properties'

const MAX_BULK = 100_000
const encodeOffset = (n: number) => Buffer.from(JSON.stringify({ o: n })).toString('base64url')
function decodeOffset(cursor?: string): number {
  if (!cursor) return 0
  try {
    const o = (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o: number }).o
    if (Number.isInteger(o) && o >= 0) return o
  } catch {
    // fall through
  }
  throw new AppError('INVALID_CURSOR', 400, 'The pagination cursor is invalid.')
}
const iso = (d: Date | null) => d?.toISOString() ?? null

/** docs/CONTACTS_AND_CONSENT.md. Every query goes through TenantDb (RLS) and FilterCompiler. */
@Injectable()
export class ContactsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------- search and count

  async search(req: SearchContactsRequest) {
    return this.tenantDb.run(async (tx) => {
      const where = await new FilterCompiler(tx).compile(req.filter, req.q)
      const offset = decodeOffset(req.cursor)
      const dir = req.sort.direction
      const orderBy: Prisma.ContactOrderByWithRelationInput[] =
        req.sort.field === 'createdAt'
          ? [{ createdAt: dir }, { id: dir }]
          : [{ [req.sort.field]: { sort: dir, nulls: 'last' } }, { id: dir }]
      const rows = await tx.contact.findMany({
        where,
        include: CONTACT_INCLUDE,
        orderBy,
        skip: offset,
        take: req.limit + 1,
      })
      const hasMore = rows.length > req.limit
      const items = (hasMore ? rows.slice(0, req.limit) : rows).map(toContact)
      return {
        items,
        page: {
          nextCursor: hasMore ? encodeOffset(offset + req.limit) : null,
          hasMore,
          limit: req.limit,
        },
      }
    })
  }

  count(filter?: ContactFilter, q?: string): Promise<number> {
    return this.tenantDb.run(async (tx) =>
      tx.contact.count({ where: await new FilterCompiler(tx).compile(filter, q) }),
    )
  }

  // -------------------------------------------------------------------------- single contact

  async get(id: string): Promise<Contact> {
    return this.tenantDb.run(async (tx) => toContact(await this.find(tx, id)))
  }

  async create(input: CreateContactRequest): Promise<Contact> {
    const { tenantId } = currentTenant()
    const actorId = currentAuth().userId
    return this.tenantDb.run(async (tx) => {
      const phone = await this.normalize(tx, tenantId, input.phone)
      await this.assertPhoneFree(tx, phone.e164)
      if (input.ownerId) await this.assertMember(tx, input.ownerId)
      const values = await this.coerceProperties(tx, input.properties ?? {}, true)
      const contact = await tx.contact.create({
        data: {
          tenantId,
          phoneE164: phone.e164,
          name: input.name ?? null,
          email: input.email ?? null,
          language: input.language ?? null,
          country: input.country ?? phone.country,
          ownerId: input.ownerId ?? null,
          source: 'MANUAL',
        },
      })
      await this.writeProperties(tx, tenantId, contact.id, values)
      if (input.tagIds?.length) {
        const tags = await tx.tag.findMany({ where: { id: { in: input.tagIds } } })
        if (tags.length !== new Set(input.tagIds).size)
          throw AppError.validation([
            { path: 'tagIds', code: 'not_found', message: 'Unknown tag.' },
          ])
        await tx.contactTag.createMany({
          data: tags.map((t) => ({
            tenantId,
            contactId: contact.id,
            tagId: t.id,
            createdBy: actorId,
          })),
        })
      }
      await addActivity(tx, {
        tenantId,
        contactId: contact.id,
        type: 'contact.created',
        data: { source: 'MANUAL' },
      })
      for (const c of input.consents ?? [])
        await recordConsent(tx, {
          tenantId,
          contactId: contact.id,
          purpose: c.purpose,
          status: c.status,
          source: c.source,
          evidence: { actorId, note: c.note ?? null, ip: requestContext.get()?.ip ?? null },
          actorId,
        })
      await this.emit(tx, tenantId, 'contact.created', contact.id, {
        contactId: contact.id,
        source: 'MANUAL',
      })
      return toContact(await this.find(tx, contact.id))
    })
  }

  async update(id: string, input: UpdateContactRequest): Promise<Contact> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const before = await this.find(tx, id)
      const data: Prisma.ContactUpdateInput = {}
      const changed: string[] = []
      if (input.phone !== undefined) {
        const phone = await this.normalize(tx, tenantId, input.phone)
        if (phone.e164 !== before.phoneE164) {
          await this.assertPhoneFree(tx, phone.e164)
          data.phoneE164 = phone.e164
          changed.push('phone')
        }
      }
      for (const key of ['name', 'email', 'language', 'country', 'status'] as const)
        if (input[key] !== undefined && input[key] !== before[key]) {
          ;(data as Record<string, unknown>)[key] = input[key]
          changed.push(key)
        }
      if (input.ownerId !== undefined && input.ownerId !== before.ownerId) {
        if (input.ownerId) await this.assertMember(tx, input.ownerId)
        data.owner = input.ownerId ? { connect: { id: input.ownerId } } : { disconnect: true }
        changed.push('ownerId')
      }
      if (Object.keys(data).length) await tx.contact.update({ where: { id }, data })
      if (input.properties) {
        const values = await this.coerceProperties(tx, input.properties, false)
        await this.writeProperties(tx, tenantId, id, values)
        changed.push(...[...values.keys()].map((k) => `property.${k}`))
      }
      if (changed.length) {
        await addActivity(tx, {
          tenantId,
          contactId: id,
          type: input.status === 'BLOCKED' ? 'contact.blocked' : 'contact.updated',
          data: { fields: changed },
        })
        await this.emit(tx, tenantId, 'contact.updated', id, {
          contactId: id,
          changedFields: changed,
        })
      }
      return toContact(await this.find(tx, id))
    })
  }

  /** Soft delete: hidden everywhere, phone freed, messages keep contact_id. Audit-logged. */
  async remove(id: string): Promise<void> {
    const { tenantId } = currentTenant()
    await this.tenantDb.run(async (tx) => {
      const contact = await this.find(tx, id)
      await tx.contact.update({ where: { id }, data: { deletedAt: new Date() } })
      await addActivity(tx, { tenantId, contactId: id, type: 'contact.deleted' })
      await this.audit.write(tx, {
        action: 'contact.deleted',
        targetType: 'contact',
        targetId: id,
        changes: { phoneE164: contact.phoneE164 },
      })
    })
  }

  // -------------------------------------------------------------------------- bulk

  async bulk(req: BulkContactsRequest): Promise<{ affected: number }> {
    const { tenantId } = currentTenant()
    const actorId = currentAuth().userId
    return this.tenantDb.run(async (tx) => {
      const where = req.filter
        ? await new FilterCompiler(tx).compile(req.filter)
        : { id: { in: req.contactIds! }, deletedAt: null }
      const ids = (
        await tx.contact.findMany({ where, select: { id: true }, take: MAX_BULK + 1 })
      ).map((c) => c.id)
      if (ids.length > MAX_BULK)
        throw new AppError(
          'LIMIT_EXCEEDED',
          422,
          `Bulk actions are limited to ${MAX_BULK} contacts.`,
        )
      if (!ids.length) return { affected: 0 }
      const activities = (type: string, data: object) =>
        tx.contactActivity.createMany({
          data: ids.map((contactId) => ({
            tenantId,
            contactId,
            type,
            actorType: 'USER' as const,
            actorId,
            data,
          })),
        })
      if (req.action === 'DELETE') {
        await tx.contact.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } })
        await activities('contact.deleted', { bulk: true })
        await this.audit.write(tx, {
          action: 'contacts.bulk_deleted',
          targetType: 'contact',
          changes: { count: ids.length, ...(req.filter ? { filter: req.filter } : {}) },
        })
        return { affected: ids.length }
      }
      const tag = await tx.tag.findFirst({ where: { id: req.tagId } })
      if (!tag) throw AppError.notFound('Tag not found.')
      if (req.action === 'TAG') {
        const res = await tx.contactTag.createMany({
          data: ids.map((contactId) => ({
            tenantId,
            contactId,
            tagId: tag.id,
            createdBy: actorId,
          })),
          skipDuplicates: true,
        })
        await activities('tag.added', { tagId: tag.id, tag: tag.name })
        return { affected: res.count }
      }
      const res = await tx.contactTag.deleteMany({
        where: { tagId: tag.id, contactId: { in: ids } },
      })
      await activities('tag.removed', { tagId: tag.id, tag: tag.name })
      return { affected: res.count }
    })
  }

  // -------------------------------------------------------------------------- related records

  async consents(id: string): Promise<ConsentRecord[]> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const rows = await tx.consent.findMany({
        where: { contactId: id },
        orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      })
      return rows.map((r) => ({
        id: r.id,
        purpose: r.purpose,
        status: r.status,
        source: r.source,
        capturedAt: r.capturedAt.toISOString(),
        revokedAt: iso(r.revokedAt),
        revokeSource: r.revokeSource,
        evidence: r.evidence as Record<string, unknown>,
      }))
    })
  }

  async changeConsent(
    id: string,
    input: { purpose: 'MARKETING' | 'UTILITY'; status: 'GRANTED' | 'REVOKED'; note: string },
  ): Promise<Contact> {
    const { tenantId } = currentTenant()
    const actorId = currentAuth().userId
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const applied = await recordConsent(tx, {
        tenantId,
        contactId: id,
        purpose: input.purpose,
        status: input.status,
        source: 'MANUAL',
        evidence: { actorId, note: input.note, ip: requestContext.get()?.ip ?? null },
        actorId,
      })
      if (!applied)
        throw new AppError(
          'CONFLICT',
          409,
          `Consent for ${input.purpose.toLowerCase()} is already ${input.status.toLowerCase()}.`,
        )
      return toContact(await this.find(tx, id))
    })
  }

  async notes(id: string): Promise<ContactNote[]> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const rows = await tx.contactNote.findMany({
        where: { contactId: id, deletedAt: null },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      return rows.map((n) => ({
        id: n.id,
        body: n.body,
        authorId: n.authorId,
        authorName: n.author.name,
        createdAt: n.createdAt.toISOString(),
      }))
    })
  }

  async addNote(id: string, body: string): Promise<ContactNote> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const note = await tx.contactNote.create({
        data: { tenantId, contactId: id, authorId: userId, body },
        include: { author: { select: { name: true } } },
      })
      await addActivity(tx, {
        tenantId,
        contactId: id,
        type: 'note.added',
        data: { noteId: note.id },
      })
      return {
        id: note.id,
        body: note.body,
        authorId: note.authorId,
        authorName: note.author.name,
        createdAt: note.createdAt.toISOString(),
      }
    })
  }

  async activities(
    id: string,
    cursor?: string,
  ): Promise<{ items: ContactActivity[]; nextCursor: string | null }> {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const offset = decodeOffset(cursor)
      const rows = await tx.contactActivity.findMany({
        where: { contactId: id },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: 51,
      })
      const users = await tx.user.findMany({
        where: {
          id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] },
        },
        select: { id: true, name: true },
      })
      const names = new Map(users.map((u) => [u.id, u.name]))
      return {
        items: rows.slice(0, 50).map((r) => ({
          id: r.id,
          type: r.type,
          actorType: r.actorType,
          actorId: r.actorId,
          actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
          data: r.data as Record<string, unknown>,
          occurredAt: r.occurredAt.toISOString(),
        })),
        nextCursor: rows.length > 50 ? encodeOffset(offset + 50) : null,
      }
    })
  }

  async conversations(id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id)
      const rows = await tx.conversation.findMany({
        where: { contactId: id },
        include: { phoneNumber: { select: { displayPhoneNumber: true } } },
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      })
      return rows.map((c) => ({
        id: c.id,
        status: c.status,
        phoneNumber: c.phoneNumber.displayPhoneNumber,
        lastMessageAt: iso(c.lastMessageAt),
        lastMessagePreview: c.lastMessagePreview,
        serviceWindowExpiresAt: iso(c.serviceWindowExpiresAt),
      }))
    })
  }

  // -------------------------------------------------------------------------- helpers

  private async find(tx: TenantTx, id: string) {
    const contact = await tx.contact.findFirst({
      where: { id, deletedAt: null },
      include: CONTACT_INCLUDE,
    })
    if (!contact) throw AppError.notFound('Contact not found.')
    return contact
  }

  private async normalize(tx: TenantTx, tenantId: string, input: string) {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { defaultCountry: true },
    })
    const phone = normalizePhone(input, tenant.defaultCountry)
    if (!phone.ok)
      throw new AppError('INVALID_PHONE', 422, phone.reason, undefined, [
        { path: 'phone', code: 'invalid_phone', message: phone.reason },
      ])
    return phone
  }

  private async assertPhoneFree(tx: TenantTx, e164: string): Promise<void> {
    const existing = await tx.contact.findFirst({
      where: { phoneE164: e164, deletedAt: null },
      select: { id: true },
    })
    if (existing)
      throw new AppError('CONFLICT', 409, 'A contact with this phone number already exists.', {
        contactId: existing.id,
      })
  }

  private async assertMember(tx: TenantTx, userId: string): Promise<void> {
    const member = await tx.membership.findFirst({ where: { userId, status: 'ACTIVE' } })
    if (!member)
      throw AppError.validation([
        { path: 'ownerId', code: 'not_member', message: 'The owner must be a team member.' },
      ])
  }

  /** Validates `properties` against the tenant's definitions (and required ones on create). */
  private async coerceProperties(tx: TenantTx, input: Record<string, unknown>, creating: boolean) {
    const defs = (await tx.contactPropertyDefinition.findMany({
      where: { archivedAt: null },
    })) as DefinitionRow[]
    const byKey = new Map(defs.map((d) => [d.key, d]))
    const errors: Array<{ path: string; code: string; message: string }> = []
    const out = new Map<
      string,
      { def: DefinitionRow; value: ReturnType<typeof coercePropertyValue> }
    >()
    for (const [key, raw] of Object.entries(input)) {
      const def = byKey.get(key)
      if (!def) {
        errors.push({
          path: `properties.${key}`,
          code: 'unknown_property',
          message: `There is no property "${key}".`,
        })
        continue
      }
      const value = coercePropertyValue(def, raw)
      if ('error' in value)
        errors.push({ path: `properties.${key}`, code: 'invalid', message: value.error })
      else out.set(key, { def, value })
    }
    if (creating)
      for (const def of defs)
        if (def.required && !(out.get(def.key)?.value as { value: unknown } | undefined)?.value)
          errors.push({
            path: `properties.${def.key}`,
            code: 'required',
            message: `${def.label} is required.`,
          })
    if (errors.length) throw AppError.validation(errors)
    return out
  }

  private async writeProperties(
    tx: TenantTx,
    tenantId: string,
    contactId: string,
    values: Awaited<ReturnType<ContactsService['coerceProperties']>>,
  ): Promise<void> {
    for (const { def, value } of values.values()) {
      const stored = 'value' in value ? value.value : null
      if (!stored) {
        await tx.contactPropertyValue.deleteMany({ where: { contactId, definitionId: def.id } })
        continue
      }
      await tx.contactPropertyValue.upsert({
        where: { contactId_definitionId: { contactId, definitionId: def.id } },
        create: { tenantId, contactId, definitionId: def.id, ...stored },
        update: stored,
      })
    }
  }

  private emit(
    tx: TenantTx,
    tenantId: string,
    eventType: string,
    contactId: string,
    payload: object,
  ) {
    return tx.outboxEvent.create({
      data: {
        tenantId,
        eventType,
        aggregateType: 'contact',
        aggregateId: contactId,
        payload,
        correlationId: requestContext.correlationId() ?? null,
      },
    })
  }
}
