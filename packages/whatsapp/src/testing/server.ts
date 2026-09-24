import { startMetaMock } from './meta-mock'

// Entry point of the fenwira-meta-mock container: `node dist/testing/server.js`.
const port = Number(process.env.PORT ?? 4200)
void startMetaMock(port).then(({ server }) => {
  process.stdout.write(`meta-mock listening on :${port}\n`)
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
})
