import { uuidv7 } from '@fenwira/config'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Database, type TenantTx } from '../src'

/**
 * Generated cross-tenant matrix (docs/prompts/PHASE_03 → Mandatory security tests).
 * Every public table with a tenant_id column MUST have a fixture here; the first test fails when a
 * new tenant table appears without one, so coverage can't silently lag behind the schema.
 */
type Fixture = (tx: TenantTx, ctx: { tenantId: string; userId: string }) => Promise<unknown>

const metaId = () => String(Math.floor(Math.random() * 1e15)).padStart(15, '1')
const waba = (tx: TenantTx, tenantId: string) =>
  tx.whatsAppBusinessAccount.create({ data: { tenantId, wabaId: metaId(), name: 'Matrix WABA' } })

const execution = async (tx: TenantTx, tenantId: string) => {
  const f = await tx.flow.create({ data: { tenantId, name: 'Matrix exec flow' } })
  const v = await tx.flowVersion.create({ data: { tenantId, flowId: f.id, version: 1, graph: {} } })
  return tx.automationExecution.create({
    data: {
      tenantId,
      flowId: f.id,
      flowVersionId: v.id,
      contactId: (await contact(tx, tenantId)).id,
      triggerEvent: {},
    },
  })
}

const invoice = (tx: TenantTx, tenantId: string) =>
  tx.invoice.create({
    data: {
      tenantId,
      number: `FW-INV-M${uuidv7()}`,
      kind: 'WALLET_TOPUP',
      subtotalMinor: 100n,
      totalMinor: 100n,
      description: 'Matrix',
      dueAt: new Date(),
      payeeVpa: 'matrix@bank',
      payeeName: 'Matrix',
      createdByType: 'SYSTEM',
    },
  })

const wallet = (tx: TenantTx, tenantId: string) =>
  tx.wallet.upsert({ where: { tenantId }, create: { tenantId }, update: {} })

const contact = (tx: TenantTx, tenantId: string) =>
  tx.contact.create({
    data: { tenantId, phoneE164: `+91${metaId().slice(0, 10)}`, source: 'INBOUND' },
  })
const conversation = async (tx: TenantTx, tenantId: string) => {
  const phone = await tx.whatsAppPhoneNumber.create({
    data: {
      tenantId,
      wabaId: (await waba(tx, tenantId)).id,
      phoneNumberId: metaId(),
      displayPhoneNumber: '+1',
      verifiedName: 'Matrix',
    },
  })
  return tx.conversation.create({
    data: { tenantId, contactId: (await contact(tx, tenantId)).id, phoneNumberId: phone.id },
  })
}

const definition = (tx: TenantTx, tenantId: string) =>
  tx.contactPropertyDefinition.create({
    data: { tenantId, key: `k_${metaId()}`, label: 'Matrix', type: 'TEXT' },
  })
const tag = (tx: TenantTx, tenantId: string) =>
  tx.tag.create({ data: { tenantId, name: `tag-${metaId()}` } })
const file = (tx: TenantTx, tenantId: string) =>
  tx.file.create({
    data: {
      tenantId,
      bucket: 'fenwira-imports',
      objectKey: `${tenantId}/${metaId()}`,
      mimeType: 'text/csv',
      sizeBytes: 1,
      purpose: 'IMPORT',
    },
  })
const importJob = async (tx: TenantTx, tenantId: string, userId: string) =>
  tx.importJob.create({
    data: { tenantId, fileId: (await file(tx, tenantId)).id, createdBy: userId },
  })

const FIXTURES: Record<string, Fixture> = {
  native_connections: (tx, { tenantId }) =>
    tx.nativeConnection.create({
      data: { tenantId, provider: 'ERPNEXT', label: 'Matrix', site: 'https://example.com' },
    }),
  native_oauth_challenges: (tx, { tenantId, userId }) =>
    tx.nativeOauthChallenge.create({
      data: {
        tenantId,
        userId,
        sessionId: uuidv7(),
        stateHash: Buffer.from(uuidv7()),
        provider: 'GOOGLE_SHEETS',
        label: 'Matrix',
        region: 'com',
        verifierCiphertext: Buffer.from('ciphertext'),
        expiresAt: new Date(Date.now() + 60000),
      },
    }),
  native_transfers: async (tx, { tenantId, userId }) => {
    const c = await tx.nativeConnection.create({
      data: { tenantId, provider: 'ERPNEXT', label: 'Matrix' },
    })
    return tx.nativeTransfer.create({
      data: {
        tenantId,
        connectionId: c.id,
        actorId: userId,
        idempotencyKey: uuidv7(),
        requestHash: 'hash',
        request: {},
      },
    })
  },
  outbox_events: (tx, { tenantId }) =>
    tx.outboxEvent.create({ data: { tenantId, eventType: 'test.event', payload: {} } }),
  memberships: (tx, { tenantId, userId }) =>
    tx.membership.create({ data: { tenantId, userId, role: 'VIEWER' } }),
  invitations: (tx, { tenantId, userId }) =>
    tx.invitation.create({
      data: { tenantId, email: `${uuidv7()}@matrix.test`, role: 'AGENT', invitedById: userId },
    }),
  audit_logs: (tx, { tenantId }) =>
    tx.auditLog.create({
      data: { tenantId, actorType: 'SYSTEM', action: 'test.action', targetType: 'test' },
    }),
  meta_business_accounts: (tx, { tenantId }) =>
    tx.metaBusinessAccount.create({
      data: { tenantId, metaBusinessId: metaId(), name: 'Matrix Business' },
    }),
  whatsapp_business_accounts: (tx, { tenantId }) => waba(tx, tenantId),
  whatsapp_phone_numbers: async (tx, { tenantId }) =>
    tx.whatsAppPhoneNumber.create({
      data: {
        tenantId,
        wabaId: (await waba(tx, tenantId)).id,
        phoneNumberId: metaId(),
        displayPhoneNumber: '+1 555-000-0000',
        verifiedName: 'Matrix',
        status: 'CONNECTED',
      },
    }),
  meta_credentials: async (tx, { tenantId }) =>
    tx.metaCredential.create({
      data: {
        tenantId,
        wabaId: (await waba(tx, tenantId)).id,
        tokenCiphertext: Uint8Array.from([1, 2, 3]),
        tokenPrefix: 'EAAG',
        tokenLast4: 'abcd',
        tokenType: 'DEV',
      },
    }),
  contacts: (tx, { tenantId }) => contact(tx, tenantId),
  contact_property_definitions: (tx, { tenantId }) => definition(tx, tenantId),
  contact_property_values: async (tx, { tenantId }) =>
    tx.contactPropertyValue.create({
      data: {
        tenantId,
        contactId: (await contact(tx, tenantId)).id,
        definitionId: (await definition(tx, tenantId)).id,
        valueText: 'x',
      },
    }),
  tags: (tx, { tenantId }) => tag(tx, tenantId),
  contact_tags: async (tx, { tenantId }) =>
    tx.contactTag.create({
      data: {
        tenantId,
        contactId: (await contact(tx, tenantId)).id,
        tagId: (await tag(tx, tenantId)).id,
      },
    }),
  contact_notes: async (tx, { tenantId, userId }) =>
    tx.contactNote.create({
      data: { tenantId, contactId: (await contact(tx, tenantId)).id, authorId: userId, body: 'n' },
    }),
  consents: async (tx, { tenantId }) =>
    tx.consent.create({
      data: {
        tenantId,
        contactId: (await contact(tx, tenantId)).id,
        purpose: 'MARKETING',
        status: 'GRANTED',
        source: 'MANUAL',
        evidence: {},
      },
    }),
  contact_activities: async (tx, { tenantId }) =>
    tx.contactActivity.create({
      data: {
        tenantId,
        contactId: (await contact(tx, tenantId)).id,
        type: 'contact.created',
        actorType: 'SYSTEM',
        data: {},
      },
    }),
  segments: (tx, { tenantId, userId }) =>
    tx.segment.create({
      data: { tenantId, name: 'Matrix', filter: { op: 'AND', rules: [] }, createdBy: userId },
    }),
  import_jobs: (tx, { tenantId, userId }) => importJob(tx, tenantId, userId),
  import_job_errors: async (tx, { tenantId, userId }) =>
    tx.importJobError.create({
      data: {
        tenantId,
        importJobId: (await importJob(tx, tenantId, userId)).id,
        rowNumber: 2,
        code: 'INVALID_PHONE',
        message: 'x',
      },
    }),
  export_jobs: (tx, { tenantId, userId }) =>
    tx.exportJob.create({
      data: {
        tenantId,
        createdBy: userId,
        filter: { op: 'AND', rules: [] },
        expiresAt: new Date(Date.now() + 3600_000),
      },
    }),
  conversations: (tx, { tenantId }) => conversation(tx, tenantId),
  messages: async (tx, { tenantId }) => {
    const c = await conversation(tx, tenantId)
    return tx.message.create({
      data: {
        tenantId,
        conversationId: c.id,
        contactId: c.contactId,
        direction: 'INBOUND',
        type: 'TEXT',
        status: 'RECEIVED',
        source: 'CUSTOMER',
        content: { type: 'TEXT', text: 'matrix' },
        providerMessageId: `wamid.${metaId()}`,
      },
    })
  },
  webhook_events: (tx, { tenantId }) =>
    tx.webhookEvent.create({
      data: { tenantId, dedupeKey: `msg:${metaId()}`, kind: 'MESSAGE', payload: {} },
    }),
  files: (tx, { tenantId }) =>
    tx.file.create({
      data: {
        tenantId,
        bucket: 'fenwira-media',
        objectKey: `${tenantId}/${metaId()}`,
        mimeType: 'image/png',
        sizeBytes: 1,
        purpose: 'MESSAGE_MEDIA',
      },
    }),
  commercial_operations: (tx, { tenantId, userId }) =>
    tx.commercialOperation.create({
      data: {
        tenantId,
        operatorId: userId,
        operation: 'test',
        reason: 'test',
        reference: 'fixture',
        idempotencyKey: uuidv7(),
        requestHash: 'fixture',
        before: {},
        after: {},
        result: {},
      },
    }),
  idempotency_keys: (tx, { tenantId }) =>
    tx.idempotencyKey.create({
      data: {
        tenantId,
        key: metaId(),
        scope: 'matrix',
        requestHash: Uint8Array.from([1]),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    }),
  conversation_read_states: async (tx, { tenantId, userId }) =>
    tx.conversationReadState.create({
      data: { tenantId, conversationId: (await conversation(tx, tenantId)).id, userId },
    }),
  conversation_notes: async (tx, { tenantId, userId }) =>
    tx.conversationNote.create({
      data: {
        tenantId,
        conversationId: (await conversation(tx, tenantId)).id,
        authorId: userId,
        body: 'internal',
      },
    }),
  conversation_tags: async (tx, { tenantId }) =>
    tx.conversationTag.create({
      data: {
        tenantId,
        conversationId: (await conversation(tx, tenantId)).id,
        tagId: (await tag(tx, tenantId)).id,
      },
    }),
  notifications: (tx, { tenantId, userId }) =>
    tx.notification.create({
      data: { tenantId, userId, type: 'test', title: 't', body: 'b' },
    }),
  templates: async (tx, { tenantId }) =>
    tx.template.create({
      data: {
        tenantId,
        wabaId: (await waba(tx, tenantId)).id,
        name: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        language: 'en',
        category: 'UTILITY',
      },
    }),
  template_versions: async (tx, { tenantId }) => {
    const t = await tx.template.create({
      data: {
        tenantId,
        wabaId: (await waba(tx, tenantId)).id,
        name: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        language: 'en',
        category: 'UTILITY',
      },
    })
    return tx.templateVersion.create({
      data: { tenantId, templateId: t.id, version: 1, components: {}, variableSamples: {} },
    })
  },
  campaigns: (tx, { tenantId }) =>
    tx.campaign.create({ data: { tenantId, name: 'Matrix', audience: {}, variableMapping: {} } }),
  campaign_recipients: async (tx, { tenantId }) => {
    const campaign = await tx.campaign.create({
      data: { tenantId, name: 'Matrix R', audience: {}, variableMapping: {} },
    })
    const c = await contact(tx, tenantId)
    return tx.campaignRecipient.create({
      data: {
        tenantId,
        campaignId: campaign.id,
        contactId: c.id,
        phoneE164: c.phoneE164,
        variables: {},
      },
    })
  },
  wallets: (tx, { tenantId }) => wallet(tx, tenantId),
  wallet_transactions: async (tx, { tenantId }) =>
    tx.walletTransaction.create({
      data: {
        tenantId,
        walletId: (await wallet(tx, tenantId)).id,
        type: 'CREDIT',
        amountMinor: 100n,
        balanceAfterMinor: 100n,
        reason: 'matrix',
        idempotencyKey: `m-${Date.now()}-${Math.random()}`,
      },
    }),
  wallet_reservations: async (tx, { tenantId }) =>
    tx.walletReservation.create({
      data: {
        tenantId,
        walletId: (await wallet(tx, tenantId)).id,
        messageId: crypto.randomUUID(),
        amountMinor: 10n,
      },
    }),
  usage_events: (tx, { tenantId }) =>
    tx.usageEvent.create({
      data: {
        tenantId,
        type: 'WA_MESSAGE_BILLABLE',
        messageId: crypto.randomUUID(),
        category: 'UTILITY',
        unitPriceMinor: 13n,
        amountMinor: 13n,
        currency: 'INR',
      },
    }),
  flows: (tx, { tenantId }) => tx.flow.create({ data: { tenantId, name: 'Matrix flow' } }),
  flow_versions: async (tx, { tenantId }) => {
    const f = await tx.flow.create({ data: { tenantId, name: 'Matrix flow v' } })
    return tx.flowVersion.create({ data: { tenantId, flowId: f.id, version: 1, graph: {} } })
  },
  automation_trigger_runs: async (tx, { tenantId }) =>
    tx.automationTriggerRun.create({
      data: {
        tenantId,
        eventId: crypto.randomUUID(),
        triggerType: 'trigger.keyword',
        contactId: (await contact(tx, tenantId)).id,
        triggerEvent: {},
        plan: [],
      },
    }),
  automation_executions: async (tx, { tenantId }) => execution(tx, tenantId),
  automation_execution_steps: async (tx, { tenantId }) =>
    tx.automationExecutionStep.create({
      data: {
        tenantId,
        executionId: (await execution(tx, tenantId)).id,
        seq: 1,
        nodeId: 't',
        nodeType: 'trigger.keyword',
        status: 'SUCCEEDED',
      },
    }),
  canned_replies: (tx, { tenantId, userId }) =>
    tx.cannedReply.create({
      data: { tenantId, shortcut: `/t${Date.now()}`, title: 't', body: 'b', createdBy: userId },
    }),
  analytics_events: (tx, { tenantId }) =>
    tx.analyticsEvent.create({
      data: {
        tenantId,
        sourceEventId: crypto.randomUUID(),
        eventType: 'message.inbound.received',
        occurredAt: new Date(),
      },
    }),
  analytics_daily_rollups: (tx, { tenantId }) =>
    tx.analyticsDailyRollup.create({
      data: { tenantId, day: new Date('2026-09-01'), metric: `m.${Date.now()}`, value: 1n },
    }),
  analytics_conversation_episodes: (tx, { tenantId }) =>
    tx.analyticsConversationEpisode.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        conversationId: crypto.randomUUID(),
        openedAt: new Date(),
        day: new Date('2026-09-01'),
      },
    }),
  analytics_dirty: (tx, { tenantId }) =>
    tx.analyticsDirty.create({ data: { tenantId, scope: 'day', key: `${Date.now()}` } }),
  analytics_tenant_state: (tx, { tenantId }) =>
    tx.analyticsTenantState.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    }),
  invoices: (tx, { tenantId }) => invoice(tx, tenantId),
  payment_proofs: async (tx, { tenantId, userId }) =>
    tx.paymentProof.create({
      data: {
        tenantId,
        invoiceId: (await invoice(tx, tenantId)).id,
        utr: `M${uuidv7().replace(/-/g, '').slice(0, 20).toUpperCase()}`,
        submittedById: userId,
      },
    }),
  subscriptions: (tx, { tenantId }) =>
    tx.subscription.upsert({
      where: { tenantId },
      create: { tenantId, status: 'TRIALING', trialEndsAt: new Date(Date.now() + 86_400_000) },
      update: {},
    }),
  tenant_entitlement_overrides: (tx, { tenantId }) =>
    tx.tenantEntitlementOverride.create({
      data: { tenantId, key: 'max_contacts', value: 10, reason: 'Matrix' },
    }),
  api_keys: (tx, { tenantId, userId }) =>
    tx.apiKey.create({
      data: {
        tenantId,
        name: 'Matrix key',
        prefix: crypto.randomUUID().replace(/-/g, '').slice(0, 8),
        keyHash: Buffer.from('x'.repeat(32)),
        scopes: ['contacts.read'],
        createdBy: userId,
      },
    }),
  webhook_endpoints: (tx, { tenantId, userId }) =>
    tx.webhookEndpoint.create({
      data: {
        tenantId,
        name: 'Matrix endpoint',
        url: 'https://example.test/hook',
        secretCiphertext: Buffer.from('x'.repeat(32)),
        events: ['message.status.changed'],
        createdBy: userId,
      },
    }),
  webhook_deliveries: async (tx, { tenantId, userId }) => {
    const ep = await tx.webhookEndpoint.create({
      data: {
        tenantId,
        name: 'Matrix endpoint for delivery',
        url: 'https://example.test/hook',
        secretCiphertext: Buffer.from('x'.repeat(32)),
        events: ['message.status.changed'],
        createdBy: userId,
      },
    })
    return tx.webhookDelivery.create({
      data: {
        tenantId,
        endpointId: ep.id,
        eventId: crypto.randomUUID(),
        eventType: 'message.status.changed',
        payload: {},
      },
    })
  },
  webhook_subscriptions: async (tx, { tenantId }) =>
    tx.webhookSubscription.create({
      data: { tenantId, wabaId: (await waba(tx, tenantId)).id, subscribedFields: ['messages'] },
    }),
}

const APPEND_ONLY = new Set([
  'commercial_operations',
  'audit_logs',
  'contact_activities',
  'wallet_transactions',
  'usage_events',
  'automation_execution_steps',
  'analytics_events',
])
/** Financial history (ADR-0027 manual billing): rows change state but are never deleted. */
const NO_DELETE = new Set(['invoices', 'payment_proofs'])

const appUrl = process.env.DATABASE_URL!
const ownerUrl = process.env.MIGRATION_DATABASE_URL!
let db: Database
let owner: Client
let tenantTables: string[]
const A = { tenantId: uuidv7(), userId: uuidv7() }
const B = { tenantId: uuidv7(), userId: uuidv7() }

async function seedTenant(t: { tenantId: string; userId: string }, name: string) {
  await db.withGlobal((tx) =>
    tx.user.create({
      data: { id: t.userId, email: `${t.userId}@matrix.test`, name, passwordHash: 'x' },
    }),
  )
  await db.withTenant(t.tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: t.tenantId, name, slug: `matrix-${t.tenantId}`, ownerUserId: t.userId },
    })
    await tx.membership.create({ data: { tenantId: t.tenantId, userId: t.userId, role: 'OWNER' } })
    for (const [table, fixture] of Object.entries(FIXTURES)) {
      if (table === 'memberships') continue // the OWNER row above is this tenant's membership fixture
      await fixture(tx, t)
    }
  })
}

beforeAll(async () => {
  db = Database.connect({ url: appUrl, poolSize: 4 })
  owner = new Client({ connectionString: ownerUrl })
  await owner.connect()
  const { rows } = await owner.query<{ table: string }>(`
    SELECT c.relname AS table FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`)
  tenantTables = rows.map((r) => r.table)
  await seedTenant(A, 'Tenant A')
  await seedTenant(B, 'Tenant B')
})

afterAll(async () => {
  await db?.disconnect()
  await owner?.end()
})

describe('coverage', () => {
  it('has a fixture for every tenant-owned table in the schema', () => {
    expect(tenantTables.sort()).toEqual(Object.keys(FIXTURES).sort())
  })
})

describe.each(Object.keys(FIXTURES))('%s', (table) => {
  const bound = <T>(fn: (tx: TenantTx) => Promise<T>) =>
    db.withTenant(A.tenantId, fn, { userId: A.userId })

  it('Tenant A cannot read Tenant B rows', async () => {
    const rows = await bound((tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1::uuid`,
        B.tenantId,
      ),
    )
    expect(Number(rows[0]!.n)).toBe(0)
    const own = await bound((tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1::uuid`,
        A.tenantId,
      ),
    )
    expect(Number(own[0]!.n)).toBeGreaterThan(0)
  })

  it('Tenant A cannot update or delete Tenant B rows', async () => {
    const update = () =>
      bound((tx) =>
        tx.$executeRawUnsafe(
          `UPDATE ${table} SET tenant_id = tenant_id WHERE tenant_id = $1::uuid`,
          B.tenantId,
        ),
      )
    const remove = () =>
      bound((tx) =>
        tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE tenant_id = $1::uuid`, B.tenantId),
      )
    if (APPEND_ONLY.has(table)) {
      // Append-only: the runtime role can't update or delete at all, in any tenant.
      await expect(update()).rejects.toThrow(/permission denied/)
      await expect(remove()).rejects.toThrow(/permission denied/)
    } else if (NO_DELETE.has(table)) {
      expect(await update()).toBe(0)
      await expect(remove()).rejects.toThrow(/permission denied/)
    } else {
      expect(await update()).toBe(0)
      expect(await remove()).toBe(0)
    }
    const stillThere = await db.withTenant(B.tenantId, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${table}`),
    )
    expect(Number(stillThere[0]!.n)).toBeGreaterThan(0)
  })

  it('Tenant A cannot write a row labelled with Tenant B (WITH CHECK)', async () => {
    await expect(
      bound((tx) => FIXTURES[table]!(tx, { tenantId: B.tenantId, userId: A.userId })),
    ).rejects.toThrow(/row-level security/)
  })

  it('no bound tenant sees zero rows', async () => {
    const rows = await db.withGlobal((tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${table}`),
    )
    expect(Number(rows[0]!.n)).toBe(0)
  })
})

describe('tenant root and memberships', () => {
  it('a user lists only their own tenants and memberships before choosing one', async () => {
    const seen = await db.withUser(A.userId, async (tx) => ({
      tenants: (await tx.tenant.findMany()).map((t) => t.id),
      memberships: (await tx.membership.findMany()).map((m) => m.tenantId),
    }))
    expect(seen).toEqual({ tenants: [A.tenantId], memberships: [A.tenantId] })
  })

  it('membership never grants writes to another tenant row', async () => {
    const updated = await db.withTenant(
      B.tenantId,
      (tx) => tx.tenant.updateMany({ where: { id: A.tenantId }, data: { name: 'hijacked' } }),
      {
        userId: A.userId,
      },
    )
    expect(updated.count).toBe(0)
  })

  it('allows exactly one active OWNER per tenant', async () => {
    const other = uuidv7()
    await db.withGlobal((tx) =>
      tx.user.create({
        data: { id: other, email: `${other}@matrix.test`, name: 'x', passwordHash: 'x' },
      }),
    )
    await expect(
      db.withTenant(A.tenantId, (tx) =>
        tx.membership.create({ data: { tenantId: A.tenantId, userId: other, role: 'OWNER' } }),
      ),
    ).rejects.toThrow(/Unique constraint|unique/i)
  })

  it('audit logs are append-only for the runtime role', async () => {
    await expect(
      db.withTenant(A.tenantId, (tx) => tx.auditLog.updateMany({ data: { action: 'tampered' } })),
    ).rejects.toThrow(/permission denied/)
    await expect(db.withTenant(A.tenantId, (tx) => tx.auditLog.deleteMany())).rejects.toThrow(
      /permission denied/,
    )
  })

  it('role and permission catalogs are seeded and read-only', async () => {
    const roles = await db.withGlobal((tx) => tx.role.findMany({ orderBy: { rank: 'desc' } }))
    expect(roles.map((r) => r.key)).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'])
    await expect(
      db.withGlobal((tx) => tx.role.update({ where: { key: 'VIEWER' }, data: { rank: 99 } })),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('whatsapp phone numbers (Phase 4)', () => {
  const phoneIn = (t: typeof A, phoneNumberId: string, status: 'CONNECTED' | 'DISCONNECTED') =>
    db.withTenant(t.tenantId, async (tx) =>
      tx.whatsAppPhoneNumber.create({
        data: {
          tenantId: t.tenantId,
          wabaId: (await waba(tx, t.tenantId)).id,
          phoneNumberId,
          displayPhoneNumber: '+1 555-000-0001',
          verifiedName: 'Matrix',
          status,
        },
      }),
    )

  it('a live number belongs to one tenant; X11 says so without naming it', async () => {
    const number = metaId()
    await phoneIn(A, number, 'CONNECTED')
    await expect(db.system.phoneNumberOwnerExists(number, B.tenantId)).resolves.toBe(true)
    await expect(db.system.phoneNumberOwnerExists(number, A.tenantId)).resolves.toBe(false)
    await expect(phoneIn(B, number, 'CONNECTED')).rejects.toThrow(/Unique constraint|unique/i)
  })

  it('a disconnected number can be connected by another tenant', async () => {
    const number = metaId()
    await phoneIn(A, number, 'DISCONNECTED')
    await expect(db.system.phoneNumberOwnerExists(number, B.tenantId)).resolves.toBe(false)
    await expect(phoneIn(B, number, 'CONNECTED')).resolves.toBeDefined()
  })

  it('X5 returns only IDs of live numbers due for sync', async () => {
    const due = await db.system.phoneNumbersDueForSync(new Date(Date.now() + 60_000), 1000)
    expect(due.length).toBeGreaterThan(0)
    expect(Object.keys(due[0]!).sort()).toEqual(['phoneId', 'tenantId'])
  })

  it('allows one default number per tenant', async () => {
    const make = () =>
      db.withTenant(A.tenantId, async (tx) =>
        tx.whatsAppPhoneNumber.create({
          data: {
            tenantId: A.tenantId,
            wabaId: (await waba(tx, A.tenantId)).id,
            phoneNumberId: metaId(),
            displayPhoneNumber: '+1',
            verifiedName: 'x',
            isDefault: true,
          },
        }),
      )
    await make()
    await expect(make()).rejects.toThrow(/Unique constraint|unique/i)
  })
})

describe('messaging (Phase 5)', () => {
  it('X2 resolves a live number to its tenant and ignores unknown numbers', async () => {
    const phone = await db.withTenant(A.tenantId, async (tx) =>
      tx.whatsAppPhoneNumber.create({
        data: {
          tenantId: A.tenantId,
          wabaId: (await waba(tx, A.tenantId)).id,
          phoneNumberId: metaId(),
          displayPhoneNumber: '+1',
          verifiedName: 'x',
          status: 'CONNECTED',
        },
        include: { waba: true },
      }),
    )
    await expect(db.system.resolveTenantByPhoneNumberId(phone.phoneNumberId)).resolves.toEqual({
      tenantId: A.tenantId,
      phoneId: phone.id,
    })
    await expect(db.system.resolveTenantByWabaId(phone.waba.wabaId)).resolves.toBe(A.tenantId)
    await expect(db.system.resolveTenantByPhoneNumberId('0')).resolves.toBeNull()
  })

  it('one message per provider id and per idempotency key; status rank orders the ladder', async () => {
    const key = `k-${metaId()}`
    const wamid = `w-${metaId()}`
    await db.withTenant(A.tenantId, async (tx) => {
      const c = await conversation(tx, A.tenantId)
      const base = {
        tenantId: A.tenantId,
        conversationId: c.id,
        contactId: c.contactId,
        direction: 'OUTBOUND' as const,
        type: 'TEXT' as const,
        status: 'CREATED' as const,
        source: 'API' as const,
        content: {},
      }
      await tx.message.create({ data: { ...base, idempotencyKey: key, providerMessageId: wamid } })
    })
    const dup = (data: Record<string, string>) =>
      db.withTenant(A.tenantId, async (tx) => {
        const c = await conversation(tx, A.tenantId)
        return tx.message.create({
          data: {
            tenantId: A.tenantId,
            conversationId: c.id,
            contactId: c.contactId,
            direction: 'OUTBOUND',
            type: 'TEXT',
            status: 'CREATED',
            source: 'API',
            content: {},
            ...data,
          },
        })
      })
    await expect(dup({ idempotencyKey: key })).rejects.toThrow(/Unique constraint|unique/i)
    await expect(dup({ providerMessageId: wamid })).rejects.toThrow(/Unique constraint|unique/i)
    const ranks = await db.withGlobal((tx) =>
      tx.$queryRawUnsafe<Array<{ r: number[] }>>(
        `SELECT array_agg(fenwira_message_status_rank(s) ORDER BY o) AS r FROM unnest(ARRAY['CREATED','QUEUED','SENDING','SENT','DELIVERED','READ','FAILED']::message_status[]) WITH ORDINALITY AS t(s, o)`,
      ),
    )
    expect(ranks[0]!.r).toEqual([0, 1, 2, 3, 4, 5, -1])
  })
})
