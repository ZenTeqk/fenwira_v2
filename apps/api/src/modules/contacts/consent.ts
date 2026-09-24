import { type TenantTx } from '@fenwira/database'
import { requestContext } from '../../core/context/request-context'

export type ConsentChange = {
  tenantId: string
  contactId: string
  purpose: 'MARKETING' | 'UTILITY'
  status: 'GRANTED' | 'REVOKED'
  source: 'INBOUND_KEYWORD' | 'MANUAL' | 'IMPORT' | 'API' | 'FORM' | 'META_OPT_OUT'
  evidence: Record<string, unknown>
  actorId?: string | null
}

const COLUMN = { MARKETING: 'marketingConsent', UTILITY: 'utilityConsent' } as const

/**
 * Records a consent change (docs/CONTACTS_AND_CONSENT.md → Consent): a new history row with its
 * evidence, `revoked_at` on the grant it ends, the contact's current-state column, a timeline
 * entry and a `consent.changed` event — all in the caller's transaction. A change to the state
 * the contact is already in is a no-op (a repeated STOP adds nothing). Returns true if applied.
 */
export async function recordConsent(tx: TenantTx, c: ConsentChange): Promise<boolean> {
  const contact = await tx.contact.findFirst({
    where: { id: c.contactId },
    select: { marketingConsent: true, utilityConsent: true },
  })
  if (!contact || contact[COLUMN[c.purpose]] === c.status) return false
  const now = new Date()
  if (c.status === 'REVOKED')
    await tx.consent.updateMany({
      where: { contactId: c.contactId, purpose: c.purpose, status: 'GRANTED', revokedAt: null },
      data: { revokedAt: now, revokeSource: c.source },
    })
  await tx.consent.create({
    data: {
      tenantId: c.tenantId,
      contactId: c.contactId,
      purpose: c.purpose,
      status: c.status,
      source: c.source,
      capturedAt: now,
      evidence: c.evidence as object,
    },
  })
  await tx.contact.update({ where: { id: c.contactId }, data: { [COLUMN[c.purpose]]: c.status } })
  await addActivity(tx, {
    tenantId: c.tenantId,
    contactId: c.contactId,
    type: c.status === 'GRANTED' ? 'consent.granted' : 'consent.revoked',
    data: { purpose: c.purpose, source: c.source, evidence: c.evidence },
    actorId: c.actorId,
  })
  await tx.outboxEvent.create({
    data: {
      tenantId: c.tenantId,
      eventType: 'consent.changed',
      aggregateType: 'contact',
      aggregateId: c.contactId,
      payload: { contactId: c.contactId, purpose: c.purpose, status: c.status, source: c.source },
      correlationId: requestContext.correlationId() ?? null,
    },
  })
  return true
}

/** Append-only contact timeline entry. `actorId` null/undefined = system. */
export async function addActivity(
  tx: TenantTx,
  a: {
    tenantId: string
    contactId: string
    type: string
    data?: Record<string, unknown>
    actorId?: string | null
  },
): Promise<void> {
  const actorId = a.actorId === undefined ? (requestContext.get()?.auth?.userId ?? null) : a.actorId
  await tx.contactActivity.create({
    data: {
      tenantId: a.tenantId,
      contactId: a.contactId,
      type: a.type,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId,
      data: (a.data ?? {}) as object,
    },
  })
}
