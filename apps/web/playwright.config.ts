import { defineConfig } from '@playwright/test'

// E2E skeleton (Phase 1). Runs against a running stack: `docker compose up -d` then `pnpm --filter @fenwira/web test:e2e`.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
  reporter: [['list']],
})
