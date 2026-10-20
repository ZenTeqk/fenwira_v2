/**
 * Phase 12 — hostile input is data.
 *
 * SQL is never assembled from strings (the filter DSL compiles to Prisma `where` objects; raw
 * queries are tagged templates), and the web app renders text through React only. This suite
 * proves the observable contract: injection, wildcard, markup and control-character payloads are
 * stored and returned verbatim, search and filters match exactly the rows that contain them, and
 * nothing answers 5xx.
 */
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { phoneNo } from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member } from './support/workspace'

const PAYLOADS = [
  // SQL
  `' OR '1'='1`,
  `' OR 1=1 --`,
  `"; DROP TABLE contacts; --`,
  `1; SELECT pg_sleep(5)`,
  // LIKE wildcards and escapes: must match literally, not everything
  '%',
  '_',
  '\\',
  `%' OR name LIKE '%`,
  // Markup (stored XSS candidates for the inbox, contact list and previews)
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg/onload=alert(1)>',
  'javascript:alert(1)',
  // Template / interpolation syntax
  '{{1}}',
  '${process.env.DATABASE_URL}',
  // Unicode tricks
  'ʼ OR ʼ1ʼ=ʼ1',
  'rtl‮evil',
  'Zoë 🚀 测试',
]

let api: INestApplication
let worker: INestApplication
let owner: Member
const names: string[] = []

const count = async (body: object) => {
  const res = await owner.client.post('/contacts/count', body)
  expect(res.status, `${JSON.stringify(body)} → ${res.text}`).toBe(200)
  return res.body.data.count as number
}
const containing = (p: string) =>
  names.filter((n) => n.toLowerCase().includes(p.toLowerCase())).length

beforeAll(async () => {
  api = await bootApi()
  worker = await bootWorker()
  owner = await createOwner(api, 'input', 'Input Co')
  owner.client.tenantId = owner.tenantId
  for (const name of ['Asha Rao', 'Ravi Kumar', 'Meena Iyer', ...PAYLOADS]) {
    const res = await owner.client.post('/contacts', { phone: phoneNo(), name })
    expect(res.status, `${name} → ${res.text}`).toBe(201)
    expect(res.body.data.name).toBe(name.trim())
    const read = await owner.client.get(`/contacts/${res.body.data.id}`)
    expect(read.body.data.name, 'stored verbatim').toBe(name.trim())
    names.push(name.trim())
  }
}, 120_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
})

describe('hostile strings in search and filters', () => {
  it('match exactly the contacts that contain them (no injection, no wildcard expansion)', async () => {
    const total = await count({})
    expect(total).toBe(names.length)
    const failures: string[] = []
    for (const p of PAYLOADS) {
      const expected = containing(p)
      const checks: Array<[string, object, number]> = [
        ['q', { q: p }, expected],
        [
          'CONTAINS',
          { filter: { op: 'AND', rules: [{ field: 'name', operator: 'CONTAINS', value: p }] } },
          expected,
        ],
        [
          'EQUALS',
          { filter: { op: 'AND', rules: [{ field: 'name', operator: 'EQUALS', value: p }] } },
          names.filter((n) => n.toLowerCase() === p.toLowerCase()).length,
        ],
        [
          'NOT_CONTAINS',
          { filter: { op: 'AND', rules: [{ field: 'name', operator: 'NOT_CONTAINS', value: p }] } },
          total - expected,
        ],
      ]
      for (const [label, body, want] of checks) {
        const got = await count(body)
        if (got !== want)
          failures.push(`${label} ${JSON.stringify(p)}: got ${got}, expected ${want}`)
      }
      const search = await owner.client.post('/contacts/search', { q: p, limit: 200 })
      expect(search.status).toBe(200)
    }
    expect(failures).toEqual([])
  })

  it('never answers 5xx for control characters (NUL) in strings', async () => {
    const nul = 'a\u0000b'
    const attempts = {
      'create contact': await owner.client.post('/contacts', { phone: phoneNo(), name: nul }),
      'search q': await owner.client.post('/contacts/search', { q: nul }),
      'filter value': await owner.client.post('/contacts/count', {
        filter: { op: 'AND', rules: [{ field: 'name', operator: 'CONTAINS', value: nul }] },
      }),
      'create tag': await owner.client.post('/tags', { name: nul }),
      'conversation search': await owner.client.get(`/conversations?q=${encodeURIComponent(nul)}`),
    }
    const crashed = Object.entries(attempts)
      .filter(([, res]) => res.status >= 500)
      .map(([what, res]) => `${what} → ${res.status}`)
    expect(crashed).toEqual([])
  })
})
