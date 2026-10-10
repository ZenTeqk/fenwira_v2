import { totpAt } from '@fenwira/api/modules/identity'
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bootApi,
  bootWorker,
  Client,
  linkFromEmail,
  PASSWORD,
  tokenFrom,
  uniqueEmail,
} from './support/harness'
import { addMember, createOwner } from './support/workspace'

let api: INestApplication
let worker: INestApplication

beforeAll(async () => {
  api = await bootApi()
  worker = await bootWorker()
})
afterAll(async () => {
  await worker?.close()
  await api?.close()
})

describe('invitations (PRD TM-1)', () => {
  it('previews and accepts as a new account; the link then stops working', async () => {
    const owner = await createOwner(api, 'inviter', 'Acme Foods')
    const email = uniqueEmail('newbie')
    const invited = await owner.client.post('/team/invitations', { email, role: 'AGENT' })
    expect(invited.status).toBe(201)
    expect(invited.body.data).toMatchObject({ email, role: 'AGENT', status: 'PENDING' })

    const link = await linkFromEmail(email, '/invitations/')
    const token = tokenFrom(link)
    const preview = await new Client(api).get(`/invitations/${token}`)
    expect(preview.body.data).toMatchObject({
      workspaceName: 'Acme Foods',
      inviterName: 'inviter Owner',
      email,
      role: 'AGENT',
      existingAccount: false,
    })

    const newbie = new Client(api)
    const accepted = await newbie.post(`/invitations/${token}/accept`, {
      name: 'New Agent',
      password: PASSWORD,
    })
    expect(accepted.status).toBe(200)
    newbie.csrf = accepted.body.data.csrfToken
    const me = await newbie.me()
    expect(me.body.data.user).toMatchObject({ email, emailVerified: true })
    expect(me.body.data.memberships).toEqual([
      expect.objectContaining({ tenantId: owner.tenantId, role: 'AGENT' }),
    ])

    expect((await new Client(api).get(`/invitations/${token}`)).status).toBe(404)
    const members = await owner.client.get('/team/members')
    expect(members.body.data.map((m: { email: string }) => m.email)).toContain(email)
  })

  it('requires existing accounts to sign in as the invited email', async () => {
    const owner = await createOwner(api, 'inv2')
    const other = await createOwner(api, 'existing')
    const since = Date.now()
    await owner.client.post('/team/invitations', { email: other.email, role: 'VIEWER' })
    const token = tokenFrom(await linkFromEmail(other.email, '/invitations/', { since }))

    const anonymous = await new Client(api).post(`/invitations/${token}/accept`, {
      name: 'x',
      password: PASSWORD,
    })
    expect(anonymous.status).toBe(409)
    expect(anonymous.body.error.details.reason).toBe('SIGN_IN_REQUIRED')

    const stranger = await createOwner(api, 'stranger')
    const mismatch = await stranger.client.post(`/invitations/${token}/accept`)
    expect(mismatch.body.error.details.reason).toBe('EMAIL_MISMATCH')

    other.client.tenantId = undefined
    const ok = await other.client.post(`/invitations/${token}/accept`)
    expect(ok.status).toBe(200)
    const tenants = (await other.client.me()).body.data.memberships.map(
      (m: { tenantId: string }) => m.tenantId,
    )
    expect(tenants).toEqual(expect.arrayContaining([other.tenantId, owner.tenantId]))
  })

  it('resend replaces the token; revoke kills it', async () => {
    const owner = await createOwner(api, 'resend')
    const email = uniqueEmail('resendee')
    const inv = (await owner.client.post('/team/invitations', { email, role: 'VIEWER' })).body.data
    const first = tokenFrom(await linkFromEmail(email, '/invitations/'))
    const since = Date.now()
    expect((await owner.client.post(`/team/invitations/${inv.id}/resend`)).status).toBe(202)
    const second = tokenFrom(await linkFromEmail(email, '/invitations/', { since }))
    expect(second).not.toBe(first)
    expect((await new Client(api).get(`/invitations/${first}`)).status).toBe(404)
    expect((await new Client(api).get(`/invitations/${second}`)).status).toBe(200)
    expect((await owner.client.post(`/team/invitations/${inv.id}/revoke`)).status).toBe(204)
    expect((await new Client(api).get(`/invitations/${second}`)).status).toBe(404)
  })

  it('rejects duplicates and members', async () => {
    const owner = await createOwner(api, 'dupinv')
    const email = uniqueEmail('twice')
    await owner.client.post('/team/invitations', { email, role: 'AGENT' })
    expect((await owner.client.post('/team/invitations', { email, role: 'AGENT' })).status).toBe(
      409,
    )
    expect(
      (await owner.client.post('/team/invitations', { email: owner.email, role: 'AGENT' })).status,
    ).toBe(409)
    expect(
      (await owner.client.post('/team/invitations', { email: uniqueEmail('o'), role: 'OWNER' }))
        .status,
    ).toBe(400)
  })
})

describe('roles and membership changes (PRD TM-2)', () => {
  it('enforces rank rules, self-protection and owner protection', async () => {
    const owner = await createOwner(api, 'ranks')
    const admin = await addMember(api, owner, 'ADMIN')
    const agent = await addMember(api, owner, 'AGENT')

    expect(
      (await admin.client.patch(`/team/members/${agent.membershipId}`, { role: 'MANAGER' })).status,
    ).toBe(204)
    expect(
      (await admin.client.patch(`/team/members/${agent.membershipId}`, { role: 'OWNER' })).status,
    ).toBe(400)
    expect(
      (await admin.client.patch(`/team/members/${admin.membershipId}`, { role: 'VIEWER' })).status,
    ).toBe(409)
    expect(
      (await admin.client.patch(`/team/members/${owner.membershipId}`, { role: 'VIEWER' })).status,
    ).toBe(409)
    expect((await admin.client.post(`/team/members/${owner.membershipId}/deactivate`)).status).toBe(
      409,
    )
    const members = (await owner.client.get('/team/members')).body.data
    expect(
      members.find((m: { membershipId: string }) => m.membershipId === agent.membershipId).role,
    ).toBe('MANAGER')
  })

  it('deactivation removes access immediately (404, not 403)', async () => {
    const owner = await createOwner(api, 'deact')
    const agent = await addMember(api, owner, 'AGENT')
    expect((await agent.client.get('/workspace')).status).toBe(200)
    expect((await owner.client.post(`/team/members/${agent.membershipId}/deactivate`)).status).toBe(
      204,
    )
    const denied = await agent.client.get('/workspace')
    expect(denied.status).toBe(404)
    expect(denied.body.error.code).toBe('TENANT_NOT_FOUND')
    expect((await agent.client.me()).body.data.memberships).toEqual([])
    expect((await owner.client.post(`/team/members/${agent.membershipId}/reactivate`)).status).toBe(
      204,
    )
    expect((await agent.client.get('/workspace')).status).toBe(200)
  })

  it('transfers ownership atomically: exactly one owner, old owner becomes admin', async () => {
    const owner = await createOwner(api, 'transfer')
    const admin = await addMember(api, owner, 'ADMIN')
    expect(
      (
        await admin.client.post('/workspace/transfer-ownership', {
          membershipId: admin.membershipId,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await owner.client.post('/workspace/transfer-ownership', {
          membershipId: admin.membershipId,
        })
      ).status,
    ).toBe(204)
    const roles = (await admin.client.get('/team/members')).body.data.map(
      (m: { membershipId: string; role: string }) => [m.membershipId, m.role],
    )
    expect(roles).toEqual(
      expect.arrayContaining([
        [admin.membershipId, 'OWNER'],
        [owner.membershipId, 'ADMIN'],
      ]),
    )
    expect(roles.filter(([, r]: string[]) => r === 'OWNER')).toHaveLength(1)
    expect((await owner.client.delete('/workspace')).status).toBe(403)
  })

  it('only the owner can delete the workspace; afterwards it is gone for everyone', async () => {
    const owner = await createOwner(api, 'delete')
    const admin = await addMember(api, owner, 'ADMIN')
    expect((await admin.client.delete('/workspace')).status).toBe(403)
    expect((await owner.client.delete('/workspace')).status).toBe(204)
    expect((await owner.client.get('/workspace')).status).toBe(404)
    expect((await admin.client.get('/workspace')).status).toBe(404)
  })
})

describe('workspace settings and require-2FA', () => {
  it('updates settings and audits the change', async () => {
    const owner = await createOwner(api, 'settings')
    const updated = await owner.client.patch('/workspace', {
      name: 'Renamed Co',
      timezone: 'Europe/London',
    })
    expect(updated.body.data).toMatchObject({ name: 'Renamed Co', timezone: 'Europe/London' })
    const audit = await owner.client.get('/audit-logs?action=workspace.')
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual([
      'workspace.updated',
      'workspace.created',
    ])
    expect(audit.body.data[0]).toMatchObject({
      actorName: 'settings Owner',
      changes: { name: [expect.any(String), 'Renamed Co'] },
    })
  })

  it('blocks members without 2FA when the workspace requires it', async () => {
    const owner = await createOwner(api, 'req2fa')
    const agent = await addMember(api, owner, 'AGENT')
    const setup = await owner.client.post('/me/2fa/setup')
    await owner.client.post('/me/2fa/enable', {
      code: totpAt(setup.body.data.secret, Math.floor(Date.now() / 30_000)),
    })
    expect((await owner.client.patch('/workspace', { require2fa: true })).status).toBe(200)
    const blocked = await agent.client.get('/workspace')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('TWO_FACTOR_ENROLLMENT_REQUIRED')
    expect((await owner.client.get('/workspace')).status).toBe(200)
  })
})

describe('tenant switching (acceptance: data changes with the tenant)', () => {
  it('returns each tenant’s own data for the same user', async () => {
    const a = await createOwner(api, 'switchA', 'Workspace A')
    const b = await createOwner(api, 'switchB', 'Workspace B')
    const shared = await addMember(api, a, 'MANAGER', 'shared')
    // Invite the same person into B (they already have A's invitation email in their inbox).
    const since = Date.now()
    await b.client.post('/team/invitations', { email: shared.email, role: 'VIEWER' })
    const token = tokenFrom(await linkFromEmail(shared.email, '/invitations/', { since }))
    shared.client.tenantId = undefined
    expect((await shared.client.post(`/invitations/${token}/accept`)).status).toBe(200)

    const tenants = (await shared.client.me()).body.data.memberships
    expect(
      tenants.map((m: { tenantName: string; role: string }) => [m.tenantName, m.role]),
    ).toEqual(
      expect.arrayContaining([
        ['Workspace A', 'MANAGER'],
        ['Workspace B', 'VIEWER'],
      ]),
    )
    shared.client.tenantId = a.tenantId
    const inA = (await shared.client.get('/workspace')).body.data.name
    const teamA = (await shared.client.get('/team/members')).body.data.map(
      (m: { email: string }) => m.email,
    )
    shared.client.tenantId = b.tenantId
    const inB = (await shared.client.get('/workspace')).body.data.name
    const teamB = (await shared.client.get('/team/members')).body.data.map(
      (m: { email: string }) => m.email,
    )
    expect([inA, inB]).toEqual(['Workspace A', 'Workspace B'])
    // Emails are normalized to lowercase by the API.
    const [ea, eb] = [a.email.toLowerCase(), b.email.toLowerCase()]
    expect(teamA).toContain(ea)
    expect(teamA).not.toContain(eb)
    expect(teamB).toContain(eb)
    expect(teamB).not.toContain(ea)
  })
})
