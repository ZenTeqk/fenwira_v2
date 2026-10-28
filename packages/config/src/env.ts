import { z } from 'zod'

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`)
    this.name = 'EnvValidationError'
  }
}

/** Parses `source` (default: process.env) against `schema`; throws one readable error listing every problem. */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source)
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    )
  }
  return result.data
}

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// or postgresql:// URL')

const redisUrl = z.string().refine((v) => /^rediss?:\/\//.test(v), 'must be a redis:// URL')

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))

const nativeConnectorEnv = {
  NATIVE_GOOGLE_CLIENT_ID: optionalString,
  NATIVE_GOOGLE_CLIENT_SECRET: optionalString,
  NATIVE_ZOHO_CLIENT_ID: optionalString,
  NATIVE_ZOHO_CLIENT_SECRET: optionalString,
  NATIVE_SHOPIFY_CLIENT_ID: optionalString,
  NATIVE_SHOPIFY_CLIENT_SECRET: optionalString,
}

/**
 * AI Assistant (docs/AI_ASSISTANT.md). `mock` answers from a deterministic stand-in (tests and
 * machines without AWS credentials); `bedrock` calls Amazon Bedrock with the SDK's default
 * credential chain (the EC2 instance role in production). Never a key in env.
 */
const aiEnv = {
  AI_PROVIDER: z.enum(['bedrock', 'mock']).default('mock'),
  AI_BEDROCK_REGION: z.string().min(1).default('ap-south-1'),
  /** Converse model or inference profile. Default: Amazon Nova Lite via the APAC profile. */
  AI_TEXT_MODEL_ID: z.string().min(1).default('apac.amazon.nova-lite-v1:0'),
  AI_EMBEDDING_MODEL_ID: z.string().min(1).default('amazon.titan-embed-text-v2:0'),
  /** Titan v2 supports 256, 512 or 1024. Changing it needs every source reprocessed. */
  AI_EMBEDDING_DIMENSION: z.coerce.number().int().min(64).max(4096).default(1024),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(50).max(2000).default(400),
  AI_RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
  /** Cosine similarity (0–1) a chunk needs to be used; below it for all → no_answer. */
  AI_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.2),
  /** Characters of retrieved text sent to the model. */
  AI_RETRIEVAL_CHAR_BUDGET: z.coerce.number().int().min(500).max(40_000).default(6000),
  AI_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(20).default(6),
  AI_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(10 * 1024 * 1024),
  AI_MAX_SOURCES_PER_WORKSPACE: z.coerce.number().int().min(1).max(1000).default(50),
  AI_MAX_CHUNKS_PER_SOURCE: z.coerce.number().int().min(1).max(10_000).default(500),
  AI_MAX_CHUNKS_PER_WORKSPACE: z.coerce.number().int().min(1).max(200_000).default(5000),
  AI_REPLY_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /** Playground questions use the monthly AI message quota unless set to false. */
  AI_PLAYGROUND_COUNTS_QUOTA: booleanString.default(true),
  AI_PLAYGROUND_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(10),
}

export const baseEnvSchema = z.object({
  ...nativeConnectorEnv,
  ...aiEnv,
  /**
   * Managed Launch Mode (ADR-0027): platform operators connect WhatsApp numbers from /platform;
   * Embedded Signup and every tenant-side Meta connection action are hidden (404). Off restores
   * self-serve Embedded Signup after Tech Provider approval.
   */
  MANAGED_LAUNCH_MODE: booleanString.default(false),
  /** B3/B4: billable sends reserve wallet funds. Off until billing launches (docs/BILLING.md). */
  BILLING_ENFORCED: booleanString.default(false),
  /**
   * Phase 11 Step 4: plans/subscriptions drive entitlements. Off = every workspace is allow-all
   * (the pre-Step-4 behaviour), so local development and existing tests are never limited.
   */
  BILLING_SUBSCRIPTIONS_ENFORCED: booleanString.default(false),
  /** P11-D5 `billing.trial_days`. */
  BILLING_TRIAL_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  /** P11-D5 `billing.trial_entitlements_plan`: whose entitlements a trial resolves to (data). */
  BILLING_TRIAL_PLAN: z.string().min(1).default('GROWTH'),
  /** P9-D1: credit (minor units) granted once to a new TRIAL tenant's wallet. 0 = none. */
  TRIAL_CREDIT_MINOR: z.coerce.number().int().min(0).default(0),
  /**
   * P11-D12 `billing.low_balance_threshold`: available funds (minor units, wallet currency) at or
   * below which a wallet is LOW_BALANCE. Default ₹100, the approved production default.
   */
  BILLING_LOW_BALANCE_THRESHOLD_MINOR: z.coerce.number().int().min(0).default(10_000),
  /** P11-D20 `billing.support_email` / `billing.support_url`: where to arrange top-ups. Optional. */
  BILLING_SUPPORT_EMAIL: optionalString.pipe(z.email().optional()),
  BILLING_SUPPORT_URL: optionalString.pipe(z.url({ protocol: /^https?$/ }).optional()),
  /**
   * ADR-0027 manual UPI billing (ML-D3). Payee of every payment request (upi://pay pa= / pn=);
   * invoices can't be issued while unset. Snapshotted on each invoice.
   */
  UPI_VPA: optionalString.pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/, 'must look like name@bank')
      .optional(),
  ),
  UPI_PAYEE_NAME: optionalString.pipe(z.string().max(99).optional()),
  /** ML-D5: days a PAST_DUE workspace keeps working before SUSPENDED (production value: business decision). */
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(90).default(7),
  /** Upgrade now: shown as "we confirm payments within X hours" on Billing. Unset hides the line. */
  BILLING_PAYMENT_CONFIRM_HOURS: optionalString
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().min(1).max(168).optional()),
  /** ML-D5: days before a period ends that the system issues its renewal invoice (priced plans only). */
  BILLING_INVOICE_LEAD_DAYS: z.coerce.number().int().min(0).max(60).default(7),
  /** ML-D3/Q22: GST is added only when both are set (one "GST" line; the split is undecided). */
  BILLING_GSTIN: optionalString.pipe(
    z
      .string()
      .regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/, 'must be a 15-character GSTIN')
      .optional(),
  ),
  // Empty (as Compose passes an unset variable) means unset, not 0.
  BILLING_GST_RATE_BPS: optionalString
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().min(1).max(10_000).optional()),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_VERSION: z.string().min(1).default('dev'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

/** Meta platform config (docs/META_INTEGRATION.md → Platform model). Never stored per tenant. */
const metaEnv = {
  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'must look like v23.0')
    .default('v23.0'),
  META_GRAPH_BASE_URL: z.url().default('https://graph.facebook.com'),
}

/** MinIO locally, S3 in production (docs/DEPLOYMENT.md). */
const storageEnv = {
  S3_ENDPOINT: z.url(),
  /** What browsers use for presigned URLs (the published MinIO port locally). */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  /**
   * Static credentials (MinIO locally). Leave both unset on AWS to use the SDK default credential
   * chain, e.g. an EC2 instance role (docs/deployment/ENVIRONMENT_VARIABLES.md).
   */
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: booleanString.default(true),
  S3_BUCKET_MEDIA: z.string().min(3).default('fenwira-media'),
  S3_BUCKET_UPLOADS: z.string().min(3).default('fenwira-uploads'),
  S3_BUCKET_IMPORTS: z.string().min(3).default('fenwira-imports'),
  S3_BUCKET_EXPORTS: z.string().min(3).default('fenwira-exports'),
}

/** Static S3 credentials come as a pair, or not at all (default credential chain). */
function checkStorageCredentials(
  env: { S3_ACCESS_KEY_ID?: string; S3_SECRET_ACCESS_KEY?: string },
  ctx: z.RefinementCtx,
): void {
  if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY))
    ctx.addIssue({
      code: 'custom',
      path: [env.S3_ACCESS_KEY_ID ? 'S3_SECRET_ACCESS_KEY' : 'S3_ACCESS_KEY_ID'],
      message: 'set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither',
    })
}

/** Listen address. 0.0.0.0 inside containers; 127.0.0.1 behind a local reverse proxy. */
const listenHost = z.string().trim().min(1).default('0.0.0.0')

const optionalPem = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))

export const apiEnvSchema = baseEnvSchema
  .extend({
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: listenHost,
    WEB_ORIGIN: z.url(),
    DATABASE_URL: postgresUrl,
    DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: redisUrl,
    /** Enables POST /api/v1/system/ping (unauthenticated end-to-end probe). Never enable in production. */
    SYSTEM_PING_ENABLED: booleanString.default(false),
    /** Ed25519 PEM keys, base64-encoded. Required in production; generated per boot otherwise. */
    JWT_PRIVATE_KEY: optionalPem,
    JWT_PUBLIC_KEY: optionalPem,
    ENCRYPTION_KEYS: z.string().min(1),
    ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
    COOKIE_SECURE: booleanString.default(false),
    /**
     * Reverse-proxy hops to trust for the client IP (X-Forwarded-For). 0 = use the socket address.
     * Set to the real number of proxies in production; never >0 when the API is exposed directly,
     * or clients can spoof their IP past per-IP rate limits.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    /** e.g. ".fenwira.com" when web and API are on sibling subdomains; unset for localhost. */
    COOKIE_DOMAIN: z.string().optional(),
    /** Marketing-site origins for POST /api/v1/public/* only (comma-separated, exact). */
    PUBLIC_SITE_ORIGINS: z
      .string()
      .default('https://fenwira.com,https://www.fenwira.com')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url())),
    ...metaEnv,
    META_WEBHOOK_VERIFY_TOKEN: optionalString,
    META_ES_CONFIG_ID: optionalString,
    /** Manual connect with a pasted token (Meta test number). Never in production. */
    WHATSAPP_DEV_CONNECT: booleanString.default(false),
    /** Public base URL of the API (webhook callback shown in docs/UI). */
    PUBLIC_API_URL: z.url().optional(),
    ...storageEnv,
    /** Internal Prometheus listener (docs/OBSERVABILITY.md); compose doesn't publish it. */
    METRICS_PORT: z.coerce.number().int().positive().optional(),
    METRICS_HOST: listenHost,
    /**
     * P10-D4 development exception, also used for webhook-endpoint URL validation at creation
     * time (Phase 11 Step 3): comma-separated host names allowed over http:/private addresses
     * (local simulated receivers). Refused in production.
     */
    AUTOMATION_WEBHOOK_DEV_HOSTS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? '')
          .split(',')
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean),
      ),
    /**
     * Server-side secret mixed into every API key hash (docs/API_KEYS.md → Storage), so a leaked
     * `key_hash` column alone can never be brute-forced offline. Required in production; a fixed
     * development value keeps local API keys working across restarts.
     */
    API_KEY_PEPPER: z.string().min(16).default('development-only-api-key-pepper'),
    /** Requests per key per minute (docs/API_KEYS.md → Rate limits). */
    API_KEY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(6000).default(120),
  })
  .superRefine((env, ctx) => {
    checkStorageCredentials(env, ctx)
    if (env.NODE_ENV !== 'production') return
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    if (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY)
      fail('JWT_PRIVATE_KEY', 'is required in production')
    if (!env.COOKIE_SECURE) fail('COOKIE_SECURE', 'must be true in production')
    if (env.SYSTEM_PING_ENABLED) fail('SYSTEM_PING_ENABLED', 'must be false in production')
    if (env.WHATSAPP_DEV_CONNECT) fail('WHATSAPP_DEV_CONNECT', 'must be false in production')
    if (env.API_KEY_PEPPER === 'development-only-api-key-pepper')
      fail('API_KEY_PEPPER', 'must be set to a real secret in production')
    if (env.AUTOMATION_WEBHOOK_DEV_HOSTS.length)
      fail('AUTOMATION_WEBHOOK_DEV_HOSTS', 'must be empty in production')
  })
export type ApiEnv = z.infer<typeof apiEnvSchema>

export const workerEnvSchema = baseEnvSchema
  .extend({
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4100),
    WORKER_HEALTH_HOST: listenHost,
    DATABASE_URL: postgresUrl,
    DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: redisUrl,
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(250),
    /** Links in emails point here. */
    WEB_ORIGIN: z.url(),
    /**
     * ADR-0027 step 4: optional. Unset = no SMTP: emails are recorded as SKIPPED_NO_SMTP and the
     * worker keeps running; links are copied from the operator console instead.
     */
    SMTP_URL: optionalString.pipe(
      z
        .string()
        .refine((v) => /^smtps?:\/\//.test(v), 'must be an smtp:// or smtps:// URL')
        .optional(),
    ),
    MAIL_FROM: z.string().min(3).default('Fenwira <no-reply@fenwira.com>'),
    MAIL_REPLY_TO: optionalString.pipe(z.email().optional()),
    ENCRYPTION_KEYS: z.string().min(1),
    ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
    ...metaEnv,
    /** How often each connected number is refreshed from Meta (quality, tier, token expiry). */
    WHATSAPP_SYNC_INTERVAL_HOURS: z.coerce.number().min(0.01).max(168).default(6),
    /** Campaign recipients handed to MessagingService per dispatch job (docs/CAMPAIGN_ENGINE.md). */
    CAMPAIGN_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
    /** Outbound retry base delay; attempts wait 2^n × base with jitter. Tests shorten it. */
    WHATSAPP_OUTBOUND_BACKOFF_MS: z.coerce.number().int().min(10).max(60_000).default(1000),
    /**
     * P10-D4 development exception: comma-separated host names the automation trigger action and
     * outbound webhook delivery (Phase 11) may call over http: or at private addresses (local
     * simulated receivers). Refused in production.
     */
    AUTOMATION_WEBHOOK_DEV_HOSTS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? '')
          .split(',')
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean),
      ),
    /**
     * Stale-reservation recovery (docs/BILLING.md → Reservations): an ACTIVE reservation whose
     * message reached a final state this long ago without being settled is recovered.
     */
    BILLING_RESERVATION_GRACE_MINUTES: z.coerce.number().int().min(1).max(10_080).default(360),
    /** Analytics recompute marks wait this long so other consumers update source rows first. */
    ANALYTICS_SETTLE_SECONDS: z.coerce.number().int().min(0).max(600).default(20),
    /** Decision O1: operational alerts (stale reservations, ledger drift) go here. Unset = log only. */
    OPS_ALERT_EMAIL: optionalString.pipe(z.email().optional()),
    /** Outbound webhook delivery (docs/WEBHOOKS.md → Retries): attempts wait 2^n × this, capped. */
    WEBHOOK_BACKOFF_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
    /** Delivery attempts stop being retried after this long since the first attempt. */
    WEBHOOK_MAX_RETRY_HOURS: z.coerce.number().min(0.1).max(168).default(24),
    /** Consecutive failed deliveries (across events) before an endpoint is auto-disabled. */
    WEBHOOK_DISABLE_AFTER_FAILURES: z.coerce.number().int().min(1).max(1000).default(20),
    ...storageEnv,
  })
  .superRefine((env, ctx) => {
    checkStorageCredentials(env, ctx)
    if (env.NODE_ENV === 'production' && env.AUTOMATION_WEBHOOK_DEV_HOSTS.length)
      ctx.addIssue({
        code: 'custom',
        path: ['AUTOMATION_WEBHOOK_DEV_HOSTS'],
        message: 'must be empty in production',
      })
  })
export type WorkerEnv = z.infer<typeof workerEnvSchema>

export const migrateEnvSchema = baseEnvSchema.extend({
  MIGRATION_DATABASE_URL: postgresUrl,
})
export type MigrateEnv = z.infer<typeof migrateEnvSchema>
