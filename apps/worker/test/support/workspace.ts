import { type Role } from '@fenwira/contracts'
import { type INestApplication } from '@nestjs/common'
import { Client, linkFromEmail, PASSWORD, tokenFrom, uniqueEmail } from './harness'

export type Member = {
  client: Client
  email: string
  tenantId: string
  membershipId: string
  role: Role
}

/** Register → verify via the emailed link → create a workspace. Returns the OWNER's client. */
export async function createOwner(
  app: INestApplication,
  label: string,
  workspaceName = `${label} Workspace`,
): Promise<Member> {
  const client = new Client(app)
  const email = uniqueEmail(label)
  await client.register(email, `${label} Owner`)
  const link = await linkFromEmail(email, '/verify-email')
  const verified = await client.post('/auth/email/verify', { token: tokenFrom(link) })
  if (verified.status !== 204)
    throw new Error(`verify ${verified.status} ${JSON.stringify(verified.body)}`)
  const created = await client.post('/tenants', { name: workspaceName })
  if (created.status !== 201)
    throw new Error(`create workspace ${created.status} ${JSON.stringify(created.body)}`)
  client.tenantId = created.body.data.id
  const me = await client.me()
  const membership = me.body.data.memberships.find(
    (m: { tenantId: string }) => m.tenantId === client.tenantId,
  )
  return {
    client,
    email,
    tenantId: client.tenantId!,
    membershipId: membership.membershipId,
    role: 'OWNER',
  }
}

/** Owner invites a new person with `role`; they accept via the emailed link as a new account. */
export async function addMember(
  app: INestApplication,
  owner: Member,
  role: Exclude<Role, 'OWNER'>,
  label = role.toLowerCase(),
): Promise<Member> {
  const email = uniqueEmail(label)
  const invited = await owner.client.post('/team/invitations', { email, role })
  if (invited.status !== 201)
    throw new Error(`invite ${invited.status} ${JSON.stringify(invited.body)}`)
  const token = tokenFrom(await linkFromEmail(email, '/invitations/'))
  const client = new Client(app)
  const accepted = await client.post(`/invitations/${token}/accept`, {
    name: `${label} person`,
    password: PASSWORD,
  })
  if (accepted.status !== 200)
    throw new Error(`accept ${accepted.status} ${JSON.stringify(accepted.body)}`)
  client.csrf = accepted.body.data.csrfToken
  client.tenantId = owner.tenantId
  const me = await client.me()
  const membership = me.body.data.memberships.find(
    (m: { tenantId: string }) => m.tenantId === owner.tenantId,
  )
  return { client, email, tenantId: owner.tenantId, membershipId: membership.membershipId, role }
}
