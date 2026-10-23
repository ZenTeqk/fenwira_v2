import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_ABSOLUTE_SECONDS, SESSION_IDLE_SECONDS } from '../src/core/security/cookies'
import { SessionService } from '../src/modules/identity/session.service'

type Row = {
  id: string
  userId: string
  familyId: string
  parentId?: string | null
  refreshTokenHash: Uint8Array
  lastUsedAt: Date
  expiresAt: Date
  revokedAt: Date | null
  revokedReason: string | null
  createdAt: Date
  userAgent: string | null
  ip: string | null
}

function fakeSessions() {
  const rows: Row[] = []
  const same = (a: Uint8Array, b: Uint8Array) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0
  const match = (r: Row, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) =>
      k === 'revokedAt' && v === null ? r.revokedAt === null : (r as never)[k] === v,
    )
  const tx = {
    session: {
      create: async ({ data }: { data: Partial<Row> }) => {
        rows.push({
          id: String(rows.length + 1),
          parentId: null,
          revokedAt: null,
          revokedReason: null,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          userAgent: null,
          ip: null,
          ...data,
        } as Row)
      },
      findUnique: async ({ where }: { where: { refreshTokenHash: Uint8Array } }) =>
        rows.find((r) => same(r.refreshTokenHash, where.refreshTokenHash)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) =>
        Object.assign(
          rows.find((r) => r.id === where.id)!,
          data,
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: Partial<Row>
      }) => {
        const hit = rows.filter((r) => match(r, where))
        hit.forEach((r) => Object.assign(r, data))
        return { count: hit.length }
      },
      findFirst: async ({ where }: { where: { familyId: string } }) =>
        [...rows]
          .reverse()
          .find((r) => r.familyId === where.familyId && !r.revokedAt && r.expiresAt > new Date()) ??
        null,
    },
  }
  const db = { withGlobal: (fn: (t: typeof tx) => unknown) => fn(tx) }
  const redis = { set: vi.fn(), exists: vi.fn(async () => 0) }
  return new SessionService(db as never, redis as never, { record: vi.fn() } as never)
}

const H = 3600_000
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T08:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('session timeouts', () => {
  it('uses a 12 h absolute and a 3 h idle limit', () => {
    expect(SESSION_ABSOLUTE_SECONDS).toBe(12 * 3600)
    expect(SESSION_IDLE_SECONDS).toBe(3 * 3600)
  })

  it('idle: expires 3 h after the last activity, even if the tab keeps polling', async () => {
    const s = fakeSessions()
    let { refreshToken } = await s.issue('u1')
    // Background refreshes (no activity header) don't restart the idle clock.
    for (const at of [1, 2, 2.9]) {
      vi.setSystemTime(new Date(Date.parse('2026-10-23T08:00:00Z') + at * H))
      const r = await s.rotate(refreshToken, false)
      expect(r.ok).toBe(true)
      if (r.ok) {
        refreshToken = r.refreshToken
        expect(r.idleExpiresAt.toISOString()).toBe('2026-10-23T11:00:00.000Z')
      }
    }
    vi.setSystemTime(new Date('2026-10-23T11:00:01Z'))
    expect(await s.rotate(refreshToken, false)).toEqual({ ok: false, reason: 'EXPIRED' })
  })

  it('activity extends the idle limit but never the 12 h absolute limit', async () => {
    const s = fakeSessions()
    const issued = await s.issue('u1')
    let refreshToken = issued.refreshToken
    const expiresAt = issued.expiresAt
    expect(expiresAt.toISOString()).toBe('2026-10-23T20:00:00.000Z')
    // Active every 2 h: the idle limit keeps moving, the absolute one doesn't.
    for (const at of [2, 4, 6, 8, 10, 11.5]) {
      vi.setSystemTime(new Date(Date.parse('2026-10-23T08:00:00Z') + at * H))
      const r = await s.rotate(refreshToken, true)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      refreshToken = r.refreshToken
      expect(r.expiresAt.toISOString()).toBe('2026-10-23T20:00:00.000Z')
      // Idle deadline = activity + 3 h, capped at the absolute end.
      expect(r.idleExpiresAt.getTime()).toBe(
        Math.min(Date.now() + 3 * H, Date.parse('2026-10-23T20:00:00Z')),
      )
    }
    vi.setSystemTime(new Date('2026-10-23T20:00:01Z'))
    expect(await s.rotate(refreshToken, true)).toEqual({ ok: false, reason: 'EXPIRED' })
  })

  it('reports the live deadlines for the web warning', async () => {
    const s = fakeSessions()
    const issued = await s.issue('u1')
    expect(await s.deadlines(issued.familyId)).toEqual({
      expiresAt: new Date('2026-10-23T20:00:00Z'),
      idleExpiresAt: new Date('2026-10-23T11:00:00Z'),
    })
  })
})

describe('access tokens', () => {
  it('never outlive the idle deadline', async () => {
    const { JwtService } = await import('../src/modules/identity/jwt.service')
    const jwt = new JwtService({} as never)
    const now = Math.floor(Date.now() / 1000)
    const token = jwt.signAccess('u1', 's1', now, new Date((now + 120) * 1000))
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
    expect(claims.exp).toBe(now + 120)
    const free = JSON.parse(
      Buffer.from(jwt.signAccess('u1', 's1', now).split('.')[1]!, 'base64url').toString(),
    )
    expect(free.exp).toBe(now + 15 * 60)
  })
})
