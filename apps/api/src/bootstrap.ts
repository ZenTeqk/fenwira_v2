import { type DestinationStream } from 'pino'
import 'reflect-metadata'
import { type ApiEnv } from '@fenwira/config'
import { json, type Request, type Response, type NextFunction } from 'express'
import { type INestApplication, RequestMethod } from '@nestjs/common'
import {
  type CorsOptions,
  type CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface'
import { NestFactory } from '@nestjs/core'
import { type NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { ApiModule } from './app.module'
import { correlationMiddleware } from './core/http/correlation.middleware'
import { RedisIoAdapter } from './modules/realtime'

/** Builds the configured API application (used by main.ts and integration tests). */
/**
 * CORS: the app origin for every route (with credentials); the marketing-site origins only for
 * the cookieless /api/v1/public/* routes (POST, no credentials). docs/SECURITY.md → CORS.
 */
export function corsOptionsFor(
  webOrigin: string,
  publicSiteOrigins: string[],
): CorsOptionsDelegate<Request> {
  const app: CorsOptions = {
    origin: webOrigin,
    credentials: true,
    exposedHeaders: ['X-Correlation-Id', 'Retry-After', 'ETag'],
    allowedHeaders: [
      'Content-Type',
      'X-Tenant-Id',
      'X-CSRF-Token',
      'X-Correlation-Id',
      'Idempotency-Key',
      // Automation drafts: optimistic concurrency (PUT /flows/:id/draft).
      'If-Match',
    ],
  }
  const site: CorsOptions = {
    origin: publicSiteOrigins,
    credentials: false,
    methods: ['POST'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  }
  return (req, cb) => cb(null, req.path.startsWith('/api/v1/public/') ? site : app)
}

export type ApiAppOptions = { logDestination?: DestinationStream }

/** Largest Meta webhook body accepted (Meta: up to 3 MB). */
export const WHATSAPP_WEBHOOK_BODY_LIMIT = '3mb'

export async function createApiApp(
  env: ApiEnv,
  options: ApiAppOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.forRoot(env, options), {
    bufferLogs: true,
    bodyParser: true,
    // Keeps req.rawBody for the WhatsApp webhook HMAC (verified on the exact bytes Meta sent).
    rawBody: true,
  })
  app.useLogger(app.get(Logger))
  app.set('trust proxy', env.TRUST_PROXY)
  app.disable('x-powered-by')
  // Must run first so every later middleware and log line carries the correlation id.
  app.use(correlationMiddleware)
  // Meta webhook payloads can be up to 3 MB (Graph docs, Webhooks → Payload size). Parsed here, before
  // Nest's global parser (registered at init, 100 kB default) so only this path gets the larger
  // limit; the global parser then skips the already-parsed body. Keeps rawBody for the HMAC check.
  // Wrapped in a named function: Nest skips its own JSON parser if it finds a middleware named
  // `jsonParser` on the Express stack, which would leave every other route without a body.
  const webhookJson = json({
    limit: WHATSAPP_WEBHOOK_BODY_LIMIT,
    verify: (req, _res, buf) => {
      ;(req as Request & { rawBody?: Buffer }).rawBody = buf
    },
  })
  app.use(
    '/api/v1/webhooks/whatsapp',
    function whatsappWebhookBody(req: Request, res: Response, next: NextFunction) {
      webhookJson(req, res, next)
    },
  )
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/v1/platform')) res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use(helmet())
  app.use(cookieParser())
  app.enableCors(corsOptionsFor(env.WEB_ORIGIN, env.PUBLIC_SITE_ORIGINS))
  const ws = new RedisIoAdapter(app, env.REDIS_URL, env.WEB_ORIGIN)
  await ws.connect()
  app.useWebSocketAdapter(ws)
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  })
  app.enableShutdownHooks()
  return app
}
