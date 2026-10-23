import { type MetaMockState, startMetaMock } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker, Client } from './support/harness'
import { createOwner, type Member } from './support/workspace'

/**
 * ADR-0027 Managed Launch Mode, step 1: with MANAGED_LAUNCH_MODE=true, Embedded Signup and every
 * tenant-side change to the Meta connection are 404 (before body validation, so the routes can't
 * be probed), while listing, renaming and test sends keep working. Both apps share one database,
 * so a number connected through the self-serve app is visible through the managed one.
 */
let mock: { server: Server; url: string; state: MetaMockState }
let selfServe: INestApplication
let managed: INestApplication
let worker: INestApplication
let owner: Member
let managedOwner: Client
let phoneId: string

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)

beforeAll(async () => {
  mock = await startMetaMock(0)
  const meta = {
    META_GRAPH_BASE_URL: mock.url,
    META_APP_ID: 'mock-app',
    META_APP_SECRET: 'mock-app-secret',
    META_ES_CONFIG_ID: 'mock-config',
  }
  selfServe = await bootApi({ ...meta, WHATSAPP_DEV_CONNECT: 'true' })
  managed = await bootApi({ ...meta, WHATSAPP_DEV_CONNECT: 'true', MANAGED_LAUNCH_MODE: 'true' })
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url })

  owner = await createOwner(selfServe, 'ml-flag')
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await fetch(`${mock.url}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({ wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] }),
  })
  const connected = await owner.client.post('/whatsapp/connections/dev', {
    ...ids,
    accessToken: `mock-dev:${ids.wabaId}`,
  })
  expect(connected.status, connected.text).toBe(201)
  phoneId = connected.body.data.id

  managedOwner = new Client(managed)
  const login = await managedOwner.login(owner.email)
  expect(login.status, login.text).toBe(200)
  managedOwner.tenantId = owner.tenantId
})

afterAll(async () => {
  await worker?.close()
  await managed?.close()
  await selfServe?.close()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('MANAGED_LAUNCH_MODE', () => {
  it('is reported to members through /auth/me', async () => {
    expect((await managedOwner.me()).body.data.features).toEqual({ managedLaunch: true })
    expect((await owner.client.me()).body.data.features).toEqual({ managedLaunch: false })
  })

  it('hides Embedded Signup and tenant-side Meta connection changes (404, even for bad bodies)', async () => {
    const blocked = [
      () => managedOwner.get('/config/whatsapp-signup'),
      () =>
        managedOwner.post('/whatsapp/connections', { code: 'x', wabaId: '1', phoneNumberId: '2' }),
      () => managedOwner.post('/whatsapp/connections', { nonsense: true }),
      () => managedOwner.post('/whatsapp/connections/dev', { wabaId: '1' }),
      () => managedOwner.post(`/whatsapp/connections/${phoneId}/retry`),
      () => managedOwner.post(`/whatsapp/connections/${phoneId}/sync`),
      () => managedOwner.post(`/whatsapp/connections/${phoneId}/rotate-token`, { bad: 1 }),
      () => managedOwner.delete(`/whatsapp/connections/${phoneId}`),
      () => managedOwner.post(`/whatsapp/connections/${randomUUID()}/sync`),
    ]
    for (const call of blocked) {
      const res = await call()
      expect(res.status, res.text).toBe(404)
      expect(res.body.error?.code).toBe('NOT_FOUND')
    }
    // The same routes still exist with the flag off.
    expect((await owner.client.get('/config/whatsapp-signup')).status).toBe(200)
  })

  it('keeps the read-only status, renaming and test sends', async () => {
    const list = await managedOwner.get('/whatsapp/connections')
    expect(list.status, list.text).toBe(200)
    expect(list.body.data).toEqual([
      expect.objectContaining({ id: phoneId, status: 'CONNECTED', qualityRating: 'GREEN' }),
    ])
    const renamed = await managedOwner.patch(`/whatsapp/connections/${phoneId}`, {
      label: 'Front desk',
    })
    expect(renamed.status, renamed.text).toBe(200)
    expect(renamed.body.data.label).toBe('Front desk')
    // Still connected: nothing the managed app refused changed the number.
    const after = await owner.client.get('/whatsapp/connections')
    expect(after.body.data[0]).toMatchObject({ id: phoneId, status: 'CONNECTED' })
  })
})
