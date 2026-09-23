import 'reflect-metadata'
import { type ApiEnv } from '@fenwira/config'
import { type INestApplication, RequestMethod } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { type NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { ApiModule } from './app.module'
import { correlationMiddleware } from './core/http/correlation.middleware'

/** Builds the configured API application (used by main.ts and integration tests). */
export async function createApiApp(env: ApiEnv): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.forRoot(env), {
    bufferLogs: true,
    bodyParser: true,
  })
  app.useLogger(app.get(Logger))
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  // Must run first so every later middleware and log line carries the correlation id.
  app.use(correlationMiddleware)
  app.use(helmet())
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    exposedHeaders: ['X-Correlation-Id'],
  })
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
