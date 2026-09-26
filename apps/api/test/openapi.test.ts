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

  it('matches the committed docs/openapi.json (run `pnpm openapi` after changing routes)', () => {
    const committed = readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'openapi.json'),
      'utf8',
    )
    expect(JSON.parse(committed)).toEqual(document)
  })
})
