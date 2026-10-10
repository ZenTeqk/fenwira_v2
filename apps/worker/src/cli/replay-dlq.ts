import { loadEnv, workerEnvSchema } from '@fenwira/config'
import { Database } from '@fenwira/database'
import {
  createQueue,
  createRedisConnection,
  type EventJob,
  jobId,
  QUEUE_JOB_OPTIONS,
  QUEUES,
} from '@fenwira/queue'

/**
 * Outbound dead-letter queue tool (docs/MESSAGING_ENGINE.md → DLQ replay).
 *   node dist/cli/replay-dlq.js                 list parked sends
 *   node dist/cli/replay-dlq.js --message <id>  requeue one message
 *   node dist/cli/replay-dlq.js --all           requeue everything
 * A replay resets the message to QUEUED with a fresh attempt budget; it never touches a message
 * that has left FAILED (for example one a status webhook later marked delivered).
 */
async function main(): Promise<void> {
  const env = loadEnv(workerEnvSchema)
  const args = process.argv.slice(2)
  const only = args.includes('--message') ? args[args.indexOf('--message') + 1] : undefined
  const replay = Boolean(only) || args.includes('--all')

  const redis = createRedisConnection(env.REDIS_URL, 'worker')
  const dlq = createQueue(QUEUES.whatsappOutboundDlq, redis)
  const outbound = createQueue(QUEUES.whatsappOutbound, redis)
  const db = Database.connect({ url: env.DATABASE_URL, poolSize: 2 })
  try {
    const jobs = await dlq.getJobs(['waiting', 'delayed', 'paused'])
    const rows = jobs.map((job) => {
      const data = job.data as EventJob<'message.outbound.requested'>
      return { job, tenantId: data.tenantId, messageId: data.payload?.messageId }
    })
    if (!replay) {
      for (const r of rows)
        process.stdout.write(
          `${r.messageId}\ttenant=${r.tenantId}\tparked=${new Date(r.job.timestamp).toISOString()}\n`,
        )
      process.stdout.write(`${rows.length} message(s) in ${QUEUES.whatsappOutboundDlq}\n`)
      return
    }
    let requeued = 0
    for (const r of rows) {
      if (!r.tenantId || !r.messageId || (only && r.messageId !== only)) continue
      const reset = await db.withTenant(r.tenantId, (tx) =>
        tx.message.updateMany({
          where: { id: r.messageId, status: 'FAILED', errorCode: 'RETRIES_EXHAUSTED' },
          data: {
            status: 'QUEUED',
            errorCode: null,
            errorDetail: null,
            failedAt: null,
            queuedAt: new Date(),
          },
        }),
      )
      if (reset.count) {
        await outbound.add('message.outbound.requested', r.job.data, {
          ...QUEUE_JOB_OPTIONS[QUEUES.whatsappOutbound],
          jobId: jobId('send', r.messageId, 'replay', Date.now()),
        })
        requeued += 1
      }
      await r.job.remove()
    }
    process.stdout.write(`requeued ${requeued} message(s)\n`)
  } finally {
    await Promise.allSettled([dlq.close(), outbound.close(), db.disconnect()])
    await redis.quit().catch(() => redis.disconnect())
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
