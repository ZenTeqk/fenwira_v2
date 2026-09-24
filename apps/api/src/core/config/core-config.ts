import { type DestinationStream } from 'pino'

export type ServiceName = 'api' | 'worker'

/** Settings shared by every server process; built from each app's validated env. */
export type CoreConfig = {
  service: ServiceName
  version: string
  nodeEnv: 'development' | 'test' | 'production'
  logLevel: string
  databaseUrl: string
  dbPoolSize: number
  redisUrl: string
  /** Allowed browser origin for CORS/CSRF (api only). */
  webOrigin?: string
  /** Tests only: capture log output (default stdout). */
  logDestination?: DestinationStream
}

export const CORE_CONFIG = Symbol('CORE_CONFIG')
