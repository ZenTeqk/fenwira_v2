import { type Database } from '@fenwira/database'
import { type MetaMockState } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { expect } from 'vitest'
import { createOwner, type Member, waitForTemplate } from './workspace'

/** Shared setup for the Phase 9 campaign suites (docs/prompts/PHASE_09_CAMPAIGNS.md). */

export const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
// Each file creates fresh tenants. A sequence guarantees unique synthetic contacts within its
// worlds; random eight-digit suffixes collided in the 2,000-contact closure regression.
let phoneSequence = 0
export const phoneNo = () => `+9193${String(++phoneSequence).padStart(8, '0')}`

export async function waitFor<T>(
  load: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = await load()
  while (!done(value)) {
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`)
    await new Promise((r) => setTimeout(r, 150))
    value = await load()
  }
  return value
}

export type CampaignWorld = {
  owner: Member
  ids: { wabaId: string; phoneNumberId: string }
  phoneId: string
  /** Approved templates imported from the mock: UTILITY with {{1}} {{2}}, MARKETING with {{1}}. */
  utility: { versionId: string; name: string }
  marketing: { versionId: string; name: string }
}

/** Owner, a connected number, and two approved templates (created in WhatsApp Manager + synced). */
export async function campaignWorld(
  api: INestApplication,
  mockUrl: string,
  label: string,
): Promise<CampaignWorld> {
  const control = (action: string, body: unknown) =>
    fetch(`${mockUrl}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })
  const owner = await createOwner(api, label)
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await control('seed', { wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] })
  const res = await owner.client.post('/whatsapp/connections/dev', {
    ...ids,
    accessToken: `mock-dev:${ids.wabaId}`,
  })
  expect(res.status, res.text).toBe(201)
  await waitForTemplate(owner, 'hello_world')
  await control('templates', {
    wabaId: ids.wabaId,
    add: [
      {
        name: 'order_update',
        language: 'en',
        category: 'UTILITY',
        status: 'APPROVED',
        components: [
          {
            type: 'BODY',
            text: 'Hi {{1}}, your order {{2}} has shipped and arrives soon.',
            example: { body_text: [['Asha', '#1']] },
          },
        ],
      },
      {
        name: 'festive_offer',
        language: 'en',
        category: 'MARKETING',
        status: 'APPROVED',
        components: [
          {
            type: 'BODY',
            text: 'Hi {{1}}, our festive offers are live this week.',
            example: { body_text: [['Asha']] },
          },
        ],
      },
    ],
  })
  expect((await owner.client.post('/templates/sync', {})).status).toBe(200)
  const approved = (await owner.client.get(`/templates/approved?phoneNumberId=${res.body.data.id}`))
    .body.data as Array<{ name: string; versionId: string }>
  const pick = (name: string) => {
    const t = approved.find((a) => a.name === name)
    expect(t, name).toBeTruthy()
    return { versionId: t!.versionId, name }
  }
  return {
    owner,
    ids,
    phoneId: res.body.data.id,
    utility: pick('order_update'),
    marketing: pick('festive_offer'),
  }
}

type SeedContact = {
  name?: string | null
  phone?: string
  marketing?: 'GRANTED' | 'REVOKED' | 'NONE'
  utility?: 'GRANTED' | 'REVOKED' | 'NONE'
  status?: 'ACTIVE' | 'BLOCKED'
  orderNo?: string | null
}

/** Contacts straight into the tenant (fast, controlled consent), all tagged with `tag`. */
export async function seedContacts(
  db: Database,
  tenantId: string,
  tag: string,
  contacts: SeedContact[],
): Promise<{ tagId: string; contactIds: string[] }> {
  return db.withTenant(tenantId, async (tx) => {
    const t = await tx.tag.create({ data: { tenantId, name: tag, color: 'INFO' } })
    const def =
      (await tx.contactPropertyDefinition.findFirst({ where: { key: 'order_no' } })) ??
      (await tx.contactPropertyDefinition.create({
        data: { tenantId, key: 'order_no', label: 'Order number', type: 'TEXT' },
      }))
    const ids: string[] = []
    for (let i = 0; i < contacts.length; i += 500) {
      const chunk = contacts.slice(i, i + 500)
      const rows = chunk.map((c) => ({
        tenantId,
        phoneE164: c.phone ?? phoneNo(),
        name: c.name === undefined ? `Person ${metaId().slice(-5)}` : c.name,
        source: 'MANUAL' as const,
        status: c.status ?? 'ACTIVE',
        marketingConsent: c.marketing ?? 'NONE',
        utilityConsent: c.utility ?? 'NONE',
      }))
      const created = await tx.contact.createManyAndReturn({ data: rows, select: { id: true } })
      ids.push(...created.map((x) => x.id))
      await tx.contactTag.createMany({
        data: created.map((x) => ({ tenantId, contactId: x.id, tagId: t.id })),
      })
      const values = created.flatMap((x, j) =>
        chunk[j]!.orderNo === null
          ? []
          : [
              {
                tenantId,
                contactId: x.id,
                definitionId: def.id,
                valueText: chunk[j]!.orderNo ?? `#${1000 + i + j}`,
              },
            ],
      )
      if (values.length) await tx.contactPropertyValue.createMany({ data: values })
    }
    return { tagId: t.id, contactIds: ids }
  })
}

/** A draft campaign to a tag with the utility template ({{1}} = first name, {{2}} = order_no). */
export async function draftCampaign(
  w: CampaignWorld,
  tagId: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const res = await w.owner.client.post('/campaigns', {
    name: `Campaign ${metaId().slice(-4)}`,
    phoneNumberId: w.phoneId,
    templateVersionId: w.utility.versionId,
    audience: { include: [{ kind: 'TAGS', tagIds: [tagId], match: 'ANY' }], exclude: [] },
    variableMapping: {
      body: [
        { kind: 'FIELD', field: 'firstName', fallback: 'there' },
        { kind: 'PROPERTY', key: 'order_no' },
      ],
    },
    ...extra,
  })
  expect(res.status, res.text).toBe(201)
  return res.body.data
}

export const launch = (w: CampaignWorld, id: string, key = `launch-${metaId()}`) =>
  w.owner.client.post(`/campaigns/${id}/launch`, {}, { 'Idempotency-Key': key })

export const campaignOf = async (w: CampaignWorld, id: string) => {
  const response = await w.owner.client.get(`/campaigns/${id}`)
  expect(response.status, JSON.stringify(response.body.error)).toBe(200)
  return response.body.data
}
export const statsOf = (w: CampaignWorld, id: string) =>
  w.owner.client.get(`/campaigns/${id}/stats`).then((r) => r.body.data)

/** Every recipient of a campaign (follows the cursor). */
export async function recipientsOf(w: CampaignWorld, id: string, query = '') {
  const all: Array<Record<string, unknown>> = []
  let cursor: string | null = null
  do {
    const res = await w.owner.client.get(
      `/campaigns/${id}/recipients?limit=200${query}${cursor ? `&cursor=${cursor}` : ''}`,
    )
    all.push(...res.body.data)
    cursor = res.body.page.nextCursor
  } while (cursor)
  return all
}

/** Meta sends of one number (the mock's record). */
export const sendsTo = (state: MetaMockState, phoneNumberId: string) =>
  state.sent.filter((s) => s.phoneNumberId === phoneNumberId)
