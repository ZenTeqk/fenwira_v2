// Validates an env file against the application's own schemas (packages/config, apps/web/lib/env)
// without starting the service. Run via check-env.sh, which loads the file with `node --env-file`.
// Prints variable names and problems only — never values.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [service, releaseDir = process.cwd()] = process.argv.slice(2)
const require = createRequire(resolve(releaseDir, 'package.json'))
const problems = []

const isProduction = process.env.NODE_ENV === 'production'
const loopback = (value) => ['127.0.0.1', '::1', 'localhost'].includes(value)

if (service === 'web') {
  for (const key of ['WEB_ORIGIN', 'API_INTERNAL_URL']) {
    try {
      new URL(process.env[key] ?? '')
    } catch {
      problems.push(`${key}: must be a URL`)
    }
  }
  if (/fenwira-api/.test(process.env.API_INTERNAL_URL ?? ''))
    problems.push('API_INTERNAL_URL: points at the Docker hostname; use http://127.0.0.1:4000')
  if (!process.env.PORT) problems.push('PORT: required (Next.js standalone listen port)')
  if (!process.env.HOSTNAME) problems.push('HOSTNAME: required (Next.js standalone listen address)')
} else if (['api', 'worker', 'migrate'].includes(service)) {
  const config = require(resolve(releaseDir, 'packages/config/dist/index.js'))
  const schema = {
    api: config.apiEnvSchema,
    worker: config.workerEnvSchema,
    migrate: config.migrateEnvSchema,
  }[service]
  try {
    const env = config.loadEnv(schema)
    if (service === 'api' && isProduction && !loopback(env.HOST))
      problems.push('HOST: bind the API to 127.0.0.1 behind nginx')
    if (service === 'api' && isProduction && env.METRICS_PORT && !loopback(env.METRICS_HOST))
      problems.push('METRICS_HOST: bind the metrics listener to 127.0.0.1')
    if (service === 'worker' && isProduction && !loopback(env.WORKER_HEALTH_HOST))
      problems.push('WORKER_HEALTH_HOST: bind the worker health port to 127.0.0.1')
    if (
      isProduction &&
      /fenwira-(postgres|redis|minio|mailpit|meta-mock)/.test(JSON.stringify(env))
    )
      problems.push('a URL still points at a Docker Compose hostname')
    // Verified TLS to a remote database: Prisma needs sslaccept=strict + sslcert (CA), node-postgres
    // (migrations) needs sslrootcert. Without them Prisma encrypts but accepts any certificate.
    const dbUrl = env.DATABASE_URL ?? env.MIGRATION_DATABASE_URL
    if (isProduction && dbUrl) {
      const u = new URL(dbUrl)
      const q = u.searchParams
      if (
        !loopback(u.hostname) &&
        !(
          ['require', 'verify-full'].includes(q.get('sslmode') ?? '') &&
          q.get('sslaccept') === 'strict' &&
          q.get('sslcert') &&
          q.get('sslrootcert')
        )
      )
        problems.push(
          `${env.DATABASE_URL ? 'DATABASE_URL' : 'MIGRATION_DATABASE_URL'}: remote database needs sslmode=require&sslaccept=strict&sslcert=<CA>&sslrootcert=<CA>`,
        )
      // Prisma loads only the FIRST certificate of sslcert: it must be the single signing root for
      // the region, never a bundle (docs/deployment/PRODUCTION_RUNTIME.md → Database TLS).
      const cert = q.get('sslcert')
      if (!loopback(u.hostname) && cert) {
        const n = existsSync(cert)
          ? (readFileSync(cert, 'utf8').match(/BEGIN CERTIFICATE/g) ?? []).length
          : -1
        if (n === -1) problems.push(`sslcert: ${cert} does not exist on this host`)
        else if (n !== 1)
          problems.push(
            `sslcert: ${cert} holds ${n} certificates; Prisma reads only the first, use the single RDS root for the region`,
          )
      }
    }
    if (
      service !== 'migrate' &&
      isProduction &&
      /^redis:\/\/(?!127\.0\.0\.1|localhost)/.test(env.REDIS_URL)
    )
      problems.push('REDIS_URL: plain redis:// to a remote host; use loopback or rediss://')
  } catch (err) {
    if (err?.name !== 'EnvValidationError') throw err
    problems.push(...err.issues)
  }
} else {
  console.error('usage: check-env.mjs <api|worker|web|migrate> [release-dir]')
  process.exit(2)
}

if (problems.length) {
  console.error(`[fenwira] ${service} environment is invalid:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`[fenwira] ${service} environment OK`)
