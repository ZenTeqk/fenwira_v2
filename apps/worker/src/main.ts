import 'reflect-metadata'
import { loadEnv, workerEnvSchema } from '@fenwira/config'
import { createWorkerApp } from './bootstrap'

async function main(): Promise<void> {
  const env = loadEnv(workerEnvSchema)
  const app = await createWorkerApp(env)
  await app.listen(env.WORKER_HEALTH_PORT, env.WORKER_HEALTH_HOST)
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
