import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../src/openapi/openapi'

const { document, routes } = buildOpenApiDocument()
type Op = { operationId: string; parameters?: Array<{ name?: string; in?: string }> }
const operations = Object.values(document.paths as Record<string, Record<string, Op>>).flatMap(
  (p) => Object.values(p),
)

describe('OpenAPI document (decision API1)', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    // ESM-only package: a dynamic import keeps this CommonJS test file loadable.
    const { Validator } = await import('@seriousme/openapi-schema-validator')
    const result = await new Validator().validate(document as never)
    expect(result.errors ?? []).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('documents every route once, with unique operation ids', () => {
    expect(routes.length).toBeGreaterThan(80)
    expect(operations).toHaveLength(routes.length)
    const ids = operations.map((o) => o.operationId)
    expect(new Set(ids).size).toBe(ids.length)
    const listed = routes.map((x) => `${x.method} ${x.path}`)
    for (const r of [
      'GET /api/v1/conversations',
      'POST /api/v1/canned-replies',
      'DELETE /api/v1/workspace',
      'GET /health/ready',
    ])
      expect(listed).toContain(r)
  })

  it('types request bodies and path parameters from the Zod contracts', () => {
    const create = (document.paths as Record<string, Record<string, Record<string, unknown>>>)[
      '/api/v1/canned-replies'
    ]!.post!
    const body = JSON.stringify(create.requestBody)
    expect(body).toContain('"shortcut"')
    expect(body).toContain('"required"')
    expect(create['x-permission']).toBe('inbox.canned_replies.manage')
    for (const op of operations)
      for (const p of op.parameters ?? [])
        if ('in' in p && p.in === 'path') expect(p.name).toMatch(/^[A-Za-z0-9_]+$/)
  })

  it('the public API allowlist matches PHASE_11_PLAN.md §5.1a exactly (decision P11-D18)', () => {
    // The frozen table (docs/plans/PHASE_11_PLAN.md → Public route allowlist v1). Any change to
    // this set is a product decision, not a code change: update the plan first.
    const ALLOWLIST_V1 = [
      'POST /api/v1/contacts/search',
      'GET /api/v1/contacts/{id}',
      'POST /api/v1/contacts',
      'PATCH /api/v1/contacts/{id}',
      'GET /api/v1/contacts/{id}/consents',
      'POST /api/v1/contacts/{id}/consents',
      'POST /api/v1/conversations',
      'POST /api/v1/conversations/{id}/messages',
      'GET /api/v1/messages/{id}',
      'GET /api/v1/conversations/{id}',
      'GET /api/v1/templates',
      'GET /api/v1/templates/approved',
      'GET /api/v1/campaigns',
      'GET /api/v1/campaigns/{id}',
      'GET /api/v1/campaigns/{id}/stats',
      'GET /api/v1/graph/{phoneNumberId}',
      'POST /api/v1/graph/{phoneNumberId}/media',
      'POST /api/v1/graph/{phoneNumberId}/messages',
    ].sort()
    const actual = routes
      .filter((r) => r.publicApi)
      .map((r) => `${r.method} ${r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`)
      .sort()
    expect(actual).toEqual(ALLOWLIST_V1)
    // Enforcement (ApiKeyGuard, via @PublicApi + @RequirePermission) and documentation (the
    // OpenAPI x-public flag) are read from the same two decorators, so they can never drift; this
    // just double-checks every public route also has a scope, and vice versa.
    for (const r of routes.filter((r) => r.publicApi)) expect(r.permission).toBeDefined()
    const publicPaths = new Set(actual)
    for (const [path, methods] of Object.entries(
      document.paths as Record<string, Record<string, Op & { 'x-public'?: boolean }>>,
    ))
      for (const [verb, op] of Object.entries(methods))
        expect(Boolean(op['x-public'])).toBe(publicPaths.has(`${verb.toUpperCase()} ${path}`))
  })

  it('matches the committed docs/openapi.json (run `pnpm openapi` after changing routes)', () => {
    const committed = readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'openapi.json'),
      'utf8',
    )
    expect(JSON.parse(committed)).toEqual(document)
  })
})
