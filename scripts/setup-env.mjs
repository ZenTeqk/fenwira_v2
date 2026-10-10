#!/usr/bin/env node
// Writes .env from .env.example with random secrets. Refuses to overwrite an existing .env.
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

if (existsSync('.env') && !process.argv.includes('--force')) {
  console.error('.env already exists (use --force to overwrite)')
  process.exit(1)
}
const secret = (bytes = 24) => randomBytes(bytes).toString('base64url')
const jwt = generateKeyPairSync('ed25519')
const pem = (key, type) => Buffer.from(key.export({ format: 'pem', type })).toString('base64')
const replacements = {
  ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  JWT_PRIVATE_KEY: pem(jwt.privateKey, 'pkcs8'),
  JWT_PUBLIC_KEY: pem(jwt.publicKey, 'spki'),
  POSTGRES_PASSWORD: secret(),
  FENWIRA_OWNER_PASSWORD: secret(),
  FENWIRA_APP_PASSWORD: secret(),
  S3_SECRET_ACCESS_KEY: secret(),
}
let env = readFileSync('.env.example', 'utf8')
for (const [key, value] of Object.entries(replacements)) {
  env = env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`)
}
writeFileSync('.env', env, { mode: 0o600 })
console.log(`.env written with fresh secrets for: ${Object.keys(replacements).join(', ')}`)
console.log(
  'Note: Postgres roles are created on the FIRST start of an empty volume; if you already',
)
console.log('have a fenwira-postgres-data volume, run `docker compose down -v` first.')
