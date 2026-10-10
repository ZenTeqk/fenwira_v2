import 'reflect-metadata'
import { apiEnvSchema, loadEnv } from '@fenwira/config'
import { createApiApp } from './bootstrap'

async function main(): Promise<void> {
  const env = loadEnv(apiEnvSchema)
  const app = await createApiApp(env)
  await app.listen(env.PORT, env.HOST)
}

main().catch((err: unknown) => {
  // Logger may not exist yet (e.g. invalid env); write plainly and exit non-zero.
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
