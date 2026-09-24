import { startMetaMock } from './meta-mock'

// Entry point of the fenwira-meta-mock container: `node dist/testing/server.js`.
// With META_MOCK_WEBHOOK_URL + META_APP_SECRET it posts signed status webhooks after each send
// and supports POST /__mock/inbound to simulate a customer message.
const port = Number(process.env.PORT ?? 4200)
void startMetaMock(port).then(({ server, state }) => {
  const url = process.env.META_MOCK_WEBHOOK_URL
  const appSecret = process.env.META_APP_SECRET
  if (url && appSecret) state.webhookTarget = { url, appSecret, delayMs: 800 }
  process.stdout.write(`meta-mock listening on :${port}${url ? ` (webhooks → ${url})` : ''}\n`)
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
})
