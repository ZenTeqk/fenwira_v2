import 'reflect-metadata'
import { type ApiEnv } from '@fenwira/config'
import { type INestApplication, RequestMethod } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { type NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { ApiModule } from './app.module'
import { correlationMiddleware } from './core/http/correlation.middleware'
import { RedisIoAdapter } from './modules/realtime'

/** Builds the configured API application (used by main.ts and integration tests). */
export async function createApiApp(env: ApiEnv): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.forRoot(env), {
    bufferLogs: true,
    bodyParser: true,
  })
  app.useLogger(app.get(Logger))
  app.set('trust proxy', env.TRUST_PROXY)
  app.disable('x-powered-by')
  // Must run first so every later middleware and log line carries the correlation id.
  app.use(correlationMiddleware)
  app.use(helmet())
  app.use(cookieParser())
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    exposedHeaders: ['X-Correlation-Id', 'Retry-After'],
    allowedHeaders: [
      'Content-Type',
      'X-Tenant-Id',
      'X-CSRF-Token',
      'X-Correlation-Id',
      'Idempotency-Key',
    ],
  })
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
