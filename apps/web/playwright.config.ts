import { defineConfig } from '@playwright/test'

// Runs against a running stack with ENABLE_UI_GALLERY=true:
//   docker compose up -d --wait && pnpm --filter @fenwira/web test:e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
  reporter: [['list']],
  // Tests share the local stack's Redis rate-limit counters (see e2e/support.ts), so run serially.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
