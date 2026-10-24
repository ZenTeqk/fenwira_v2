import { type TenantTx } from '@fenwira/database'

/**
 * Demo data for Fenwira's internal workspace only (tenants.is_internal). Everything is marked
 * [DEMO]: phone numbers are from the reserved fictional range +1 555-555-01xx, the WhatsApp
 * account and number are fake and DISCONNECTED (no Meta sync, no sends), and the campaign stays
 * a DRAFT. Runs once: a second run finds the demo account and does nothing.
 */
export const DEMO_WABA_ID = 'demo-waba-not-real'
const DEMO_PHONE_ID = 'demo-phone-not-real'
const DAY = 86_400_000

const PEOPLE = [
  'Asha Rao',
  'Vikram Iyer',
  'Meera Nair',
  'Rahul Verma',
  'Fatima Shaikh',
  'Arjun Menon',
  'Priya Das',
  'Karan Malhotra',
  'Lakshmi Pillai',
  'Sanjay Gupta',
  'Neha Joshi',
  'Rohan Kapoor',
]
const TEMPLATES = [
  {
    name: 'demo_festive_offer',
    category: 'MARKETING' as const,
    body: '[DEMO] Hi {{1}}, our festive sale is on: 20% off all sarees this week.',
  },
  {
    name: 'demo_order_update',
    category: 'UTILITY' as const,
    body: '[DEMO] Hi {{1}}, your order {{2}} has shipped and arrives in 3 days.',
  },
  {
    name: 'demo_welcome',
    category: 'MARKETING' as const,
    body: '[DEMO] Welcome to Fenwira Demo Store, {{1}}! Reply MENU to see our catalogue.',
  },
]
const THREADS: Array<Array<[dir: 'IN' | 'OUT', text: string]>> = [
  [
    ['IN', 'Hi, do you have the blue silk saree in stock?'],
    ['OUT', 'Yes! It is in stock in two shades. Shall I share photos?'],
    ['IN', 'Please do.'],
  ],
  [
    ['IN', 'Where is my order?'],
    ['OUT', 'It shipped yesterday and should arrive on Friday.'],
  ],
  [
    ['IN', 'Can I change my delivery address?'],
    ['OUT', 'Sure, please send the new address here.'],
    ['IN', '12 MG Road, Bengaluru'],
    ['OUT', 'Updated. Thank you!'],
  ],
  [['IN', 'What are your store timings?']],
  [
    ['IN', 'Is cash on delivery available?'],
    ['OUT', 'Yes, for orders under ₹5,000.'],
  ],
  [['IN', 'MENU']],
]

export async function seedDemoWorkspace(
  tx: TenantTx,
  tenantId: string,
  now = new Date(),
): Promise<{ seeded: boolean; contacts: number; conversations: number; templates: number }> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { isInternal: true, ownerUserId: true },
  })
  if (!tenant) throw new Error('Workspace not found')
  if (!tenant.isInternal)
    throw new Error('Refused: demo data goes only into an internal workspace (is_internal)')
  if (await tx.whatsAppBusinessAccount.findFirst({ where: { wabaId: DEMO_WABA_ID } }))
    return { seeded: false, contacts: 0, conversations: 0, templates: 0 }

  const tag = await tx.tag.create({ data: { tenantId, name: 'Demo data', color: 'WARNING' } })
  const waba = await tx.whatsAppBusinessAccount.create({
    data: {
      tenantId,
      wabaId: DEMO_WABA_ID,
      name: '[DEMO] Fenwira demo account (not connected)',
      status: 'DISCONNECTED',
      connectionMode: 'MANAGED',
    },
  })
  const phone = await tx.whatsAppPhoneNumber.create({
    data: {
      tenantId,
      wabaId: waba.id,
      phoneNumberId: DEMO_PHONE_ID,
      displayPhoneNumber: '+1 555-555-0100',
      verifiedName: '[DEMO] Fenwira Demo Store',
      label: 'Demo number (not real)',
      status: 'DISCONNECTED',
      isDefault: true,
    },
  })

  let firstVersionId: string | null = null
  for (const t of TEMPLATES) {
    const template = await tx.template.create({
      data: {
        tenantId,
        wabaId: waba.id,
        name: t.name,
        language: 'en',
        category: t.category,
        status: 'APPROVED',
        createdBy: tenant.ownerUserId,
      },
    })
    const version = await tx.templateVersion.create({
      data: {
        tenantId,
        templateId: template.id,
        version: 1,
        components: [{ type: 'BODY', text: t.body }],
        variableSamples: { body: ['Asha', 'DEMO-1001'].slice(0, t.body.split('{{').length - 1) },
        status: 'APPROVED',
        origin: 'FENWIRA',
        decidedAt: now,
        createdBy: tenant.ownerUserId,
      },
    })
    await tx.template.update({
      where: { id: template.id },
      data: { currentVersionId: version.id, approvedVersionId: version.id },
    })
    firstVersionId ??= version.id
  }

  const contacts = []
  for (const [i, person] of PEOPLE.entries()) {
    const contact = await tx.contact.create({
      data: {
        tenantId,
        phoneE164: `+1555555${String(101 + i).padStart(4, '0')}`,
        name: `[DEMO] ${person}`,
        country: 'US',
        source: 'MANUAL',
      },
    })
    await tx.contactTag.create({ data: { tenantId, contactId: contact.id, tagId: tag.id } })
    contacts.push(contact)
  }

  for (const [i, thread] of THREADS.entries()) {
    const contact = contacts[i]!
    const conversation = await tx.conversation.create({
      data: {
        tenantId,
        contactId: contact.id,
        phoneNumberId: phone.id,
        status: i % 3 === 2 ? 'RESOLVED' : 'OPEN',
      },
    })
    let at = now.getTime() - (i + 1) * DAY
    let last: { id: string; text: string; at: Date } | null = null
    let lastInbound: Date | null = null
    for (const [dir, text] of thread) {
      at += 7 * 60_000
      const message = await tx.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          contactId: contact.id,
          direction: dir === 'IN' ? 'INBOUND' : 'OUTBOUND',
          type: 'TEXT',
          status: dir === 'IN' ? 'RECEIVED' : 'READ',
          source: dir === 'IN' ? 'CUSTOMER' : 'INBOX',
          content: { type: 'TEXT', text },
          createdAt: new Date(at),
        },
      })
      last = { id: message.id, text, at: new Date(at) }
      if (dir === 'IN') lastInbound = new Date(at)
    }
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageId: last!.id,
        lastMessageAt: last!.at,
        lastMessagePreview: last!.text,
        lastCustomerMessageAt: lastInbound,
        inboundCount: thread.filter(([d]) => d === 'IN').length,
        ...(i % 3 === 2 ? { resolvedAt: last!.at } : {}),
      },
    })
    await tx.contact.update({ where: { id: contact.id }, data: { lastInboundAt: lastInbound } })
  }

  await tx.campaign.create({
    data: {
      tenantId,
      name: '[DEMO] Festive offer (sample, never sent)',
      status: 'DRAFT',
      phoneNumberId: phone.id,
      templateVersionId: firstVersionId,
      audience: { include: [{ kind: 'TAGS', tagIds: [tag.id], match: 'ANY' }], exclude: [] },
      variableMapping: {},
      timezone: 'Asia/Kolkata',
      createdBy: tenant.ownerUserId,
    },
  })
  await tx.auditLog.create({
    data: {
      tenantId,
      actorType: 'SYSTEM',
      action: 'demo.workspace_seeded',
      targetType: 'tenant',
      targetId: tenantId,
      changes: { contacts: contacts.length, conversations: THREADS.length, templates: 3 },
    },
  })
  return {
    seeded: true,
    contacts: contacts.length,
    conversations: THREADS.length,
    templates: TEMPLATES.length,
  }
}
