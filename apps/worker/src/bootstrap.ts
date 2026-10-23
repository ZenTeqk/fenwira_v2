import 'reflect-metadata'
import { type CoreConfig, correlationMiddleware } from '@fenwira/api/core'
import { type WorkerEnv } from '@fenwira/config'
import { type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'
import { WorkerModule } from './worker.module'

/**
 * The worker is a Nest app whose only HTTP surface is /health* on an internal port
 * (WORKER_HEALTH_PORT, never published to the host). Its real work is queue processors
 * and the outbox relay.
 */
export async function createWorkerApp(
  env: WorkerEnv,
  extra: Pick<CoreConfig, 'logDestination'> = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(WorkerModule.forRoot(env, extra), { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.use(correlationMiddleware)
  app.enableShutdownHooks()
  return app
}
