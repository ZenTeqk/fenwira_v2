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
}

export default config
