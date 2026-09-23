/**
 * Module-boundary rules from docs/ARCHITECTURE.md (Module rules) and AGENTS.md.
 * Runs in CI via `pnpm lint:deps`.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are forbidden (ARCHITECTURE.md rule 5).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-deep-package-imports',
      severity: 'error',
      comment:
        'Workspace packages are consumed through their package exports, never by reaching into src/.',
      from: { path: '^(apps|packages)/([^/]+)/' },
      to: { path: '^packages/([^/]+)/src/', pathNot: '^packages/$2/src/' },
    },
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      comment: 'Shared packages must not depend on applications.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-is-ui-only',
      severity: 'error',
      comment: 'apps/web never talks to Postgres, Redis, queues or api internals.',
      from: { path: '^apps/web/' },
      to: {
        path: [
          '^packages/(database|queue|whatsapp)/',
          '^apps/(api|worker)/',
          '@prisma/client',
          'bullmq',
          'ioredis',
        ],
      },
    },
    {
      name: 'raw-prisma-only-in-database',
      severity: 'error',
      comment: 'Only packages/database may use the raw Prisma client (ADR-0016).',
      from: { path: '^(apps|packages)/', pathNot: ['^packages/database/'] },
      to: { path: '@prisma/client' },
    },
    {
      name: 'api-modules-use-public-surface',
      severity: 'error',
      comment:
        'A module may reach another module only through its index.ts (ARCHITECTURE.md rule 2). Same-module imports are fine.',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/([^/]+)/',
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'core-does-not-import-modules',
      severity: 'error',
      comment: 'core is infrastructure; business modules depend on it, never the reverse.',
      from: { path: '^apps/api/src/core/' },
      to: { path: '^apps/api/src/modules/' },
    },
    {
      name: 'worker-uses-api-public-exports',
      severity: 'error',
      comment:
        'The worker consumes @fenwira/api only through its package exports (dist), not source paths.',
      from: { path: '^apps/worker/' },
      to: { path: '^apps/api/src/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)dist/', '(^|/)\\.next/', '(^|/)coverage/', '(^|/)generated/'] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
  },
}
