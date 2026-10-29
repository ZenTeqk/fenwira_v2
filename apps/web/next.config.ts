import path from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  // Self-contained server bundle for the Docker image; trace from the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  // @fenwira/ui ships TypeScript source (ADR-0021); Next compiles it with the app.
  transpilePackages: ['@fenwira/ui'],
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/automations', destination: '/automations/workflows', permanent: false },
      {
        source: '/automations/reply-studio',
        destination: '/automations/reply-studio/auto-replies',
        permanent: false,
      },
    ]
  },
  // Don't write AGENTS.md / CLAUDE.md into the app during `next dev` (repo rules live in the root AGENTS.md).
  agentRules: false,
  // The dev-mode badge overlaps the sidebar's bottom controls.
  devIndicators: false,
}

export default config
