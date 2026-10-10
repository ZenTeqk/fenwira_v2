import { NativeService } from '@fenwira/api/modules/native-connectors'
import { type NativeProvider, type NativeTransfer } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { uuidv7 } from '@fenwira/config'
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { addMember, createOwner, type Member } from './support/workspace'
let api: INestApplication,
  worker: INestApplication,
  db: Database,
  owner: Member,
  other: Member,
  manager: Member
let native: NativeService
const config = {
  NATIVE_GOOGLE_CLIENT_ID: 'native-test-google',
  NATIVE_GOOGLE_CLIENT_SECRET: 'native-test-secret',
  NATIVE_ZOHO_CLIENT_ID: 'native-test-zoho',
  NATIVE_ZOHO_CLIENT_SECRET: 'native-test-secret',
  NATIVE_SHOPIFY_CLIENT_ID: 'native-test-shop',
  NATIVE_SHOPIFY_CLIENT_SECRET: 'native-test-secret',
}
beforeAll(async () => {
  api = await bootApi(config)
  worker = await bootWorker(config)
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
  native = api.get(NativeService)
  vi.spyOn(native.providers, 'verifyErp').mockResolvedValue(undefined)
  vi.spyOn(native.providers, 'exchange').mockResolvedValue({
    accessToken: 'native-mock-access-secret',
    refreshToken: 'native-mock-refresh-secret',
    expiresAt: Date.now() + 86400000,
  })
  const processor = worker.get(NativeService)
  vi.spyOn(processor.providers, 'people').mockResolvedValue([
    {
      phone: '+919876543210',
      name: 'Native textile customer',
      email: 'native-textile@example.com',
    },
  ])
  vi.spyOn(processor.providers, 'exportSheet').mockResolvedValue(undefined)
  owner = await createOwner(api, 'native-connector')
  other = await createOwner(api, 'native-other')
  manager = await addMember(api, owner, 'MANAGER', 'native-manager')
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  await worker?.close()
  await api?.close()
  await db?.disconnect()
})
async function connection(provider: NativeProvider): Promise<string> {
  const begin = await owner.client.post('/native-connectors/connect', {
    provider,
    label: `Test ${provider}`,
    region: 'com',
    ...(provider === 'ERPNEXT'
      ? {
          site: 'https://erp.example.com',
          apiKey: 'native-mock-key',
          apiSecret: 'native-mock-secret',
        }
      : provider === 'SHOPIFY'
        ? { site: 'textiles.myshopify.com' }
        : {}),
  })
  expect(begin.status, JSON.stringify(begin.body)).toBe(201)
  if (provider === 'ERPNEXT') return begin.body.data.connection.id as string
  const complete = await owner.client.post('/native-connectors/oauth/complete', {
    state: begin.body.data.state,
    code: 'mock-code',
  })
  expect(complete.status, JSON.stringify(complete.body)).toBe(201)
  return complete.body.data.id as string
}
async function waitRun(id: string, transferId: string) {
  for (let i = 0; i < 100; i++) {
    const response = await owner.client.get(`/native-connectors/${id}/transfers`)
    const run = (response.body.data as NativeTransfer[]).find((r) => r.id === transferId)
    if (run && run.status !== 'PENDING') return run
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Native transfer did not complete')
}
async function waitImport(id: string, status: string) {
  for (let i = 0; i < 100; i++) {
    const response = await owner.client.get(`/imports/${id}`)
    if (response.body.data?.status === status) return response.body.data
    if (response.body.data?.status === 'FAILED') throw new Error('Import failed')
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Import did not reach expected state')
}
describe('native connector security and transfers', () => {
  it('denies tenant managers and public API keys', async () => {
    expect((await manager.client.get('/native-connectors')).status).toBe(403)
    const key = await owner.client.post('/api-keys', {
      name: 'Native isolation',
      scopes: ['contacts.read'],
    })
    expect(key.status).toBe(201)
    for (const path of ['/native-connectors', '/native-connectors/oauth/complete']) {
      const result = await owner.client.get(path, {
        Authorization: `Bearer ${key.body.data.secret}`,
      })
      expect(result.status).toBe(404)
    }
  })
  it('binds OAuth state to user, tenant and a single callback, including concurrent callbacks', async () => {
    const begin = await owner.client.post('/native-connectors/connect', {
      provider: 'GOOGLE_SHEETS',
      label: 'Sheets',
    })
    const body = { state: begin.body.data.state, code: 'mock-code' }
    expect((await other.client.post('/native-connectors/oauth/complete', body)).status).toBe(422)
    const results = await Promise.all([
      owner.client.post('/native-connectors/oauth/complete', body),
      owner.client.post('/native-connectors/oauth/complete', body),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 422])
    expect((await owner.client.post('/native-connectors/oauth/complete', body)).status).toBe(422)
  })
  it('rejects expired challenges and never exposes credentials or provider cost', async () => {
    const begin = await owner.client.post('/native-connectors/connect', {
      provider: 'ZOHO_CRM',
      label: 'Expired',
      region: 'in',
    })
    await db.withTenant(owner.tenantId, (tx) =>
      tx.nativeOauthChallenge.updateMany({
        where: { label: 'Expired' },
        data: { expiresAt: new Date(0) },
      }),
    )
    expect(
      (
        await owner.client.post('/native-connectors/oauth/complete', {
          state: begin.body.data.state,
          code: 'mock-code',
        })
      ).status,
    ).toBe(422)
    await connection('ERPNEXT')
    const listing = await owner.client.get('/native-connectors')
    expect(JSON.stringify(listing.body)).not.toMatch(
      /native-mock|secretCiphertext|refreshToken|accessToken|providerCost|apiSecret/,
    )
  })
  it.each(['ERPNEXT', 'ZOHO_CRM', 'SHOPIFY'] as NativeProvider[])(
    '%s prepares the existing consent-safe import workflow through the outbox',
    async (provider) => {
      const id = await connection(provider)
      const key = uuidv7()
      const started = await owner.client.post(`/native-connectors/${id}/transfers`, {
        idempotencyKey: key,
      })
      expect(started.status, JSON.stringify(started.body)).toBe(202)
      const replay = await owner.client.post(`/native-connectors/${id}/transfers`, {
        idempotencyKey: key,
      })
      expect(replay.body.data.id).toBe(started.body.data.id)
      const run = await waitRun(id, started.body.data.id)
      expect(run.status).toBe('SUCCEEDED')
      expect(run.rows).toBe(1)
      const imported = await waitImport(run.importJobId!, 'MAPPING')
      expect(imported.suggestedMapping.Phone).toBe('phone')
      if (provider === 'ERPNEXT') {
        const mapping = await owner.client.patch(`/imports/${run.importJobId}`, {
          columnMapping: { Phone: 'phone', Name: 'name', Email: 'email' },
          duplicatePolicy: 'SKIP',
          suppressAutomations: true,
        })
        expect(mapping.status).toBe(200)
        await waitImport(run.importJobId!, 'PREVIEW_READY')
        expect((await owner.client.post(`/imports/${run.importJobId}/confirm`)).status).toBe(200)
        await waitImport(run.importJobId!, 'COMPLETED')
        const contacts = await owner.client.post('/contacts/search', {
          q: 'Native textile customer',
        })
        expect(contacts.body.data[0].marketingConsent).toBe('NONE')
      }
      const receipts = await db.withTenant(owner.tenantId, (tx) =>
        tx.nativeTransfer.count({ where: { idempotencyKey: key } }),
      )
      expect(receipts).toBe(1)
      const audits = await db.withTenant(owner.tenantId, (tx) =>
        tx.auditLog.findMany({ where: { targetId: run.id } }),
      )
      expect(audits.map((a) => a.action)).toContain('native.transfer_completed')
    },
  )
  it('Sheets requires explicit disclosure confirmation, exports an immutable snapshot and keeps other tenants out', async () => {
    const id = await connection('GOOGLE_SHEETS')
    expect((await other.client.get(`/native-connectors/${id}/transfers`)).status).toBe(404)
    expect(
      (
        await owner.client.post(`/native-connectors/${id}/transfers`, {
          idempotencyKey: uuidv7(),
          spreadsheetId: 'sample-spreadsheet-id-1234567890',
        })
      ).status,
    ).toBe(400)
    const input = {
      idempotencyKey: uuidv7(),
      spreadsheetId: 'sample-spreadsheet-id-1234567890',
      confirmExport: true,
    }
    const started = await owner.client.post(`/native-connectors/${id}/transfers`, input)
    expect(started.status).toBe(202)
    const run = await waitRun(id, started.body.data.id)
    expect(run.status).toBe('SUCCEEDED')
    expect(run.importJobId).toBeNull()
    expect(
      (
        await owner.client.post(`/native-connectors/${id}/transfers`, {
          ...input,
          spreadsheetId: 'another-spreadsheet-id-12345678',
        })
      ).status,
    ).toBe(409)
    expect(worker.get(NativeService).providers.exportSheet).toHaveBeenCalled()
  })
  it('concurrent clicks share one durable receipt and one prepared import', async () => {
    const id = await connection('ERPNEXT')
    const input = { idempotencyKey: uuidv7() }
    const results = await Promise.all([
      owner.client.post(`/native-connectors/${id}/transfers`, input),
      owner.client.post(`/native-connectors/${id}/transfers`, input),
    ])
    expect(results.map((r) => r.status)).toEqual([202, 202])
    expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id)
    const run = await waitRun(id, results[0]!.body.data.id)
    expect(run.status).toBe('SUCCEEDED')
    expect(
      await db.withTenant(owner.tenantId, (tx) =>
        tx.importJob.count({ where: { id: run.importJobId! } }),
      ),
    ).toBe(1)
  })
  it('failed Sheets export retries the original snapshot and refuses database snapshot edits', async () => {
    const id = await connection('GOOGLE_SHEETS')
    const provider = worker.get(NativeService).providers
    vi.mocked(provider.exportSheet).mockRejectedValueOnce(
      new Error('private provider credential body'),
    )
    const started = await owner.client.post(`/native-connectors/${id}/transfers`, {
      idempotencyKey: uuidv7(),
      spreadsheetId: 'retry-spreadsheet-id-12345678',
      confirmExport: true,
    })
    const failed = await waitRun(id, started.body.data.id)
    expect(failed.status).toBe('FAILED')
    expect(JSON.stringify(failed)).not.toContain('private')
    const original = await db.withTenant(owner.tenantId, (tx) =>
      tx.nativeTransfer.findFirstOrThrow({ where: { id: failed.id } }),
    )
    await owner.client.post('/contacts', { phone: '+919812345678', name: 'Created after snapshot' })
    const retry = await owner.client.post(`/native-connectors/${id}/transfers/${failed.id}/retry`)
    expect(retry.status).toBe(202)
    const completed = await waitRun(id, failed.id)
    expect(completed.status).toBe('SUCCEEDED')
    expect(completed.rows).toBe(failed.rows)
    const after = await db.withTenant(owner.tenantId, (tx) =>
      tx.nativeTransfer.findFirstOrThrow({ where: { id: failed.id } }),
    )
    expect(after.snapshotCiphertext).toEqual(original.snapshotCiphertext)
    await expect(
      db.withTenant(owner.tenantId, (tx) =>
        tx.nativeTransfer.update({
          where: { id: failed.id },
          data: { snapshotCiphertext: Buffer.from('different snapshot') },
        }),
      ),
    ).rejects.toThrow(/immutable/)
  })
  it('rechecks actual membership before queued work can send contact data', async () => {
    const connectionId = await connection('ERPNEXT')
    const userId = (await owner.client.me()).body.data.user.id as string
    const id = uuidv7()
    // Persist a queued receipt without relaying it, so revocation happens before its claim.
    await db.withTenant(owner.tenantId, async (tx) => {
      await tx.nativeTransfer.create({
        data: {
          id,
          tenantId: owner.tenantId,
          connectionId,
          idempotencyKey: uuidv7(),
          requestHash: 'authorization-regression',
          actorId: userId,
          request: {},
        },
      })
      await tx.membership.updateMany({
        where: { id: owner.membershipId },
        data: { role: 'VIEWER' },
      })
    })
    const processor = worker.get(NativeService)
    const calls = vi.mocked(processor.providers.people).mock.calls.length
    try {
      expect(await processor.process(owner.tenantId, id)).toBe('denied')
      expect(vi.mocked(processor.providers.people).mock.calls).toHaveLength(calls)
      const receipt = await db.withTenant(owner.tenantId, (tx) =>
        tx.nativeTransfer.findFirstOrThrow({ where: { id } }),
      )
      expect(receipt.status).toBe('FAILED')
      expect(receipt.errorCode).toBe('TRANSFER_AUTHORIZATION_LOST')
      expect(receipt.snapshotCiphertext).toBeNull()
    } finally {
      await db.withTenant(owner.tenantId, (tx) =>
        tx.membership.updateMany({ where: { id: owner.membershipId }, data: { role: 'OWNER' } }),
      )
    }
  })
  it('disconnect destroys local credentials and stops new transfer work', async () => {
    const id = await connection('ERPNEXT')
    expect((await owner.client.delete(`/native-connectors/${id}`)).status).toBe(204)
    const row = await db.withTenant(owner.tenantId, (tx) =>
      tx.nativeConnection.findFirstOrThrow({ where: { id } }),
    )
    expect(row.secretCiphertext).toBeNull()
    expect(
      (await owner.client.post(`/native-connectors/${id}/transfers`, { idempotencyKey: uuidv7() }))
        .status,
    ).toBe(409)
  })
})
