import 'reflect-metadata'
import { apiEnvSchema } from '@fenwira/config'
import { errorEnvelopeSchema, type Permission, type Role } from '@fenwira/contracts'
import { type DynamicModule, RequestMethod, type Type } from '@nestjs/common'
import {
  HTTP_CODE_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants'
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum'
import { z } from 'zod'
import { ApiModule } from '../app.module'
import { IdempotencyInterceptor } from '../core/http/idempotency.interceptor'
import { ZodValidationPipe } from '../core/http/zod-validation.pipe'
import { ACCESS_COOKIE, CSRF_COOKIE } from '../core/security/cookies'
import {
  PERMISSION_KEY,
  PLATFORM_PERMISSION_KEY,
  PUBLIC_API_KEY,
  PUBLIC_KEY,
  ROLE_KEY,
  SKIP_CSRF_KEY,
  TENANT_SCOPED_KEY,
} from '../core/security/decorators'

/**
 * OpenAPI 3.1 document for the API (decision API1, docs/API_SPEC.md → OpenAPI). Generated from
 * route metadata and the Zod schemas the routes validate with, so it can't drift from what the
 * API accepts. Nothing here connects to a database: the module tree is only walked.
 */

type Json = Record<string, unknown>
const PREFIX = '/api/v1'
const UNPREFIXED = new Set(['/health', '/health/live', '/health/ready'])
const VERBS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
}

/** Placeholder configuration: enough for `forRoot` to build the module tree, never used to connect. */
function placeholderEnv() {
  return apiEnvSchema.parse({
    NODE_ENV: 'test',
    WEB_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: 'postgres://openapi@localhost/openapi',
    REDIS_URL: 'redis://localhost:6379',
    ENCRYPTION_KEYS: `k1:${Buffer.alloc(32).toString('base64')}`,
    ENCRYPTION_ACTIVE_KEY_ID: 'k1',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'openapi',
    S3_SECRET_ACCESS_KEY: 'openapi',
  })
}

/** Every controller reachable from the root module, in a stable order. */
export function collectControllers(root: DynamicModule | Type): Type[] {
  const seen = new Set<unknown>()
  const found = new Set<Type>()
  const visit = (m: unknown): void => {
    if (!m || seen.has(m)) return
    seen.add(m)
    if (typeof m === 'function') {
      for (const c of (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, m) ?? []) as Type[])
        found.add(c)
      for (const i of (Reflect.getMetadata(MODULE_METADATA.IMPORTS, m) ?? []) as unknown[]) visit(i)
      return
    }
    if (typeof m === 'object') {
      const dyn = m as Partial<DynamicModule> & { forwardRef?: () => unknown }
      if (dyn.forwardRef) return visit(dyn.forwardRef())
      for (const c of (dyn.controllers ?? []) as Type[]) found.add(c)
      for (const i of dyn.imports ?? []) visit(i)
      visit(dyn.module)
    }
  }
  visit(root)
  return [...found].sort((a, b) => a.name.localeCompare(b.name))
}

/** Zod → JSON Schema (2020-12, the dialect OpenAPI 3.1 uses), with `$defs` hoisted to components. */
function toSchema(schema: z.ZodType, name: string, components: Record<string, Json>): Json {
  const out = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as Json
  delete out.$schema
  const defs = (out.$defs ?? {}) as Record<string, Json>
  delete out.$defs
  let text = JSON.stringify(out)
  const rename: Record<string, string> = {}
  // Named schemas (`.meta({ id })` in the contracts) are shared; anonymous ones are per operation.
  for (const key of Object.keys(defs))
    rename[key] = /^__schema\d+$/.test(key) ? `${name}${key.replace(/_+/g, '_')}` : key
  const rewrite = (s: string) =>
    s.replace(/"#\/\$defs\/([^"]+)"/g, (_, key: string) => `"#/components/schemas/${rename[key]}"`)
  text = rewrite(text)
  for (const [key, def] of Object.entries(defs))
    components[rename[key]!] = JSON.parse(rewrite(JSON.stringify(def))) as Json
  return JSON.parse(text) as Json
}

type Arg = { index: number; data?: string; pipes?: unknown[] }
const zodOf = (arg: Arg) =>
  (arg.pipes ?? []).find((p): p is ZodValidationPipe<z.ZodType> => p instanceof ZodValidationPipe)
    ?.schema

export interface RouteInfo {
  method: string
  path: string
  operationId: string
  bodySchema: boolean
  querySchema: boolean
  /** Reachable by a tenant API key (decision P11-D18, docs/API_KEYS.md → allowlist). */
  publicApi: boolean
  /** The permission (and API-key scope) the route requires, when any. */
  permission?: Permission
}

export function buildOpenApiDocument(): { document: Json; routes: RouteInfo[] } {
  const controllers = collectControllers(ApiModule.forRoot(placeholderEnv()))
  const paths: Record<string, Record<string, Json>> = {}
  const components: Record<string, Json> = {}
  const routes: RouteInfo[] = []

  for (const controller of controllers) {
    const tag = controller.name.replace(/Controller$/, '')
    const bases = [Reflect.getMetadata(PATH_METADATA, controller) ?? ''].flat() as string[]
    const names = Object.getOwnPropertyNames(controller.prototype).sort()
    for (const name of names) {
      const handler = (controller.prototype as Record<string, unknown>)[name]
      if (name === 'constructor' || typeof handler !== 'function') continue
      const verbCode = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined
      const verb = verbCode === undefined ? undefined : VERBS[verbCode]
      if (!verb) continue
      const read = <T>(key: string) =>
        (Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller)) as T | undefined
      const isPublic = Boolean(read(PUBLIC_KEY))
      const permission = read<Permission>(PERMISSION_KEY)
      const role = read<Role>(ROLE_KEY)
      const platformPermission = read<string>(PLATFORM_PERMISSION_KEY)
      const isPublicApi = Boolean(read(PUBLIC_API_KEY))
      const tenantScoped = Boolean(read(TENANT_SCOPED_KEY) || permission || role)
      const interceptors = [
        ...((Reflect.getMetadata(INTERCEPTORS_METADATA, controller) ?? []) as unknown[]),
        ...((Reflect.getMetadata(INTERCEPTORS_METADATA, handler) ?? []) as unknown[]),
      ]
      const idempotent = interceptors.includes(IdempotencyInterceptor)
      const status =
        (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ??
        (verb === 'post' ? 201 : 200)
      const args = Object.entries(
        (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<string, Arg>,
      )
      const subs = [Reflect.getMetadata(PATH_METADATA, handler) ?? ''].flat() as string[]

      for (const base of bases)
        for (const sub of subs) {
          const raw = `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/')
          const full = UNPREFIXED.has(raw) ? raw : `${PREFIX}${raw === '/' ? '' : raw}`
          const oaPath = full.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
          const operationId = `${tag}_${name}`
          const parameters: Json[] = []
          let requestBody: Json | undefined
          let bodySchema = false
          let querySchema = false

          // Path parameters (typed when a Zod pipe validates them).
          for (const [, p] of full.matchAll(/:([A-Za-z0-9_]+)/g)) {
            const arg = args.find(
              ([k, a]) => k.startsWith(`${RouteParamtypes.PARAM}:`) && a.data === p,
            )?.[1]
            const s = arg && zodOf(arg)
            parameters.push({
              name: p,
              in: 'path',
              required: true,
              schema: s ? toSchema(s, `${operationId}_${p}`, components) : { type: 'string' },
            })
          }
          for (const [key, arg] of args) {
            const type = Number(key.split(':')[0])
            const s = zodOf(arg)
            if (type === RouteParamtypes.QUERY) {
              querySchema = Boolean(s)
              if (!s) continue
              const js = toSchema(s, `${operationId}_query`, components)
              if (arg.data) {
                parameters.push({ name: arg.data, in: 'query', schema: js })
                continue
              }
              const required = new Set((js.required ?? []) as string[])
              for (const [prop, schema] of Object.entries(
                (js.properties ?? {}) as Record<string, Json>,
              ))
                parameters.push({ name: prop, in: 'query', required: required.has(prop), schema })
            } else if (type === RouteParamtypes.BODY) {
              bodySchema = Boolean(s)
              requestBody = {
                required: true,
                content: {
                  'application/json': {
                    schema: s ? toSchema(s, `${operationId}_body`, components) : { type: 'object' },
                  },
                },
              }
            }
          }
          if (tenantScoped) parameters.push({ $ref: '#/components/parameters/TenantId' })
          if (!isPublic && verb !== 'get' && !read(SKIP_CSRF_KEY))
            parameters.push({ $ref: '#/components/parameters/CsrfToken' })
          if (idempotent) parameters.push({ $ref: '#/components/parameters/IdempotencyKey' })

          const responses: Json = {
            [String(status)]:
              status === 204
                ? { description: 'No content' }
                : {
                    description: 'Success',
                    content: {
                      'application/json': { schema: { $ref: '#/components/schemas/Success' } },
                    },
                  },
            default: { $ref: '#/components/responses/Error' },
          }
          const operation: Json = {
            operationId,
            tags: [tag],
            ...(parameters.length ? { parameters } : {}),
            ...(requestBody ? { requestBody } : {}),
            responses,
            security: isPublic
              ? []
              : platformPermission
                ? [{ platformSession: [] }]
                : [{ session: [] }],
            ...(platformPermission ? { 'x-platform-permission': platformPermission } : {}),
            ...(permission ? { 'x-permission': permission } : {}),
            ...(role ? { 'x-role': role } : {}),
            ...(idempotent ? { 'x-idempotent': true } : {}),
            ...(isPublicApi ? { 'x-public': true, security: [{ apiKey: [] }] } : {}),
          }
          ;(paths[oaPath] ??= {})[verb] = operation
          routes.push({
            method: verb.toUpperCase(),
            path: full,
            operationId,
            bodySchema,
            querySchema,
            publicApi: isPublicApi,
            ...(permission ? { permission } : {}),
          })
        }
    }
  }

  const sortedPaths = Object.fromEntries(
    Object.keys(paths)
      .sort()
      .map((p) => [p, paths[p]]),
  )
  const document: Json = {
    openapi: '3.1.0',
    info: {
      title: 'Fenwira API',
      version: 'v1',
      description:
        'Generated from the NestJS routes and @fenwira/contracts Zod schemas (docs/API_SPEC.md). ' +
        'Responses use the `{ data, page?, meta? }` envelope; errors use the error envelope.',
    },
    servers: [{ url: '/' }],
    paths: sortedPaths,
    components: {
      schemas: {
        ...Object.fromEntries(
          Object.keys(components)
            .sort()
            .map((k) => [k, components[k]]),
        ),
        Success: {
          type: 'object',
          properties: { data: {}, page: { type: 'object' }, meta: { type: 'object' } },
        },
        ErrorEnvelope: toSchema(errorEnvelopeSchema, 'ErrorEnvelope', components),
      },
      responses: {
        Error: {
          description: 'Error (see docs/API_SPEC.md → Errors)',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
          },
        },
      },
      parameters: {
        TenantId: {
          name: 'X-Tenant-Id',
          in: 'header',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        CsrfToken: {
          name: 'X-CSRF-Token',
          in: 'header',
          required: true,
          description: `Must equal the ${CSRF_COOKIE} cookie (double submit).`,
          schema: { type: 'string' },
        },
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      },
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: ACCESS_COOKIE },
        platformSession: { type: 'apiKey', in: 'cookie', name: 'fw_platform' },
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A tenant API key (docs/API_KEYS.md): `Authorization: Bearer fw_<prefix>_<secret>`. ' +
            'Only routes marked `x-public` accept it; every other route answers 404.',
        },
      },
    },
  }
  return { document, routes }
}
