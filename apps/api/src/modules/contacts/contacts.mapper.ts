import { type Contact, type PropertyValue } from '@fenwira/contracts'
import { type Prisma } from '@fenwira/database'
import { propertyOut } from './properties'

export const CONTACT_INCLUDE = {
  tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
  propertyValues: { include: { definition: true } },
} as const satisfies Prisma.ContactInclude

type ContactRow = Prisma.ContactGetPayload<{ include: typeof CONTACT_INCLUDE }>

export function toContact(c: ContactRow): Contact {
  const properties: Record<string, PropertyValue> = {}
  for (const v of c.propertyValues)
    if (!v.definition.archivedAt) properties[v.definition.key] = propertyOut(v.definition.type, v)
  return {
    id: c.id,
    phoneE164: c.phoneE164,
    name: c.name,
    email: c.email,
    language: c.language,
    country: c.country,
    source: c.source,
    status: c.status,
    ownerId: c.ownerId,
    waProfileName: c.waProfileName,
    marketingConsent: c.marketingConsent,
    utilityConsent: c.utilityConsent,
    tags: c.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    properties,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}
