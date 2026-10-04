import { type DestinationStream } from 'pino'

/** MinIO/S3 connection (docs/DEPLOYMENT.md). */
export type StorageConfig = {
  endpoint: string
  publicEndpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  mediaBucket: string
  importsBucket: string
  exportsBucket: string
}

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
  /** MinIO/S3; required by processes that touch files (api, worker). */
  storage?: StorageConfig
  /** API only: internal /metrics listener port (never published). Unset = off. */
  metricsPort?: number
  /** Phase 11 Step 4: how EntitlementsService resolves entitlements (docs/BILLING.md → Plans). */
  entitlements?: { enforced: boolean; trialDays: number; trialPlanKey: string }
  /** Tests only: capture log output (default stdout). */
  logDestination?: DestinationStream
}

export const CORE_CONFIG = Symbol('CORE_CONFIG')
