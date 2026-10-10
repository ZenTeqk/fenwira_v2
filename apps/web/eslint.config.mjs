import nextPlugin from '@next/eslint-plugin-next'
import globals from 'globals'
import base from '@fenwira/config/eslint'

export default [
  ...base,
  nextPlugin.configs['core-web-vitals'],
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // The web tier never touches server-only packages (docs/ARCHITECTURE.md → Runtime processes).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@fenwira/database', '@fenwira/database/*', '@prisma/client'],
              message: 'The web app never talks to Postgres.',
            },
            {
              group: ['@fenwira/queue', 'bullmq', 'ioredis'],
              message: 'The web app never talks to Redis.',
            },
            { group: ['@fenwira/api', '@fenwira/api/*'], message: 'Call the API over HTTP.' },
            {
              group: [
                'radix-ui',
                '@radix-ui/*',
                'cmdk',
                'sonner',
                '@tanstack/react-table',
                'class-variance-authority',
              ],
              message: 'UI primitives come from @fenwira/ui only (AGENTS.md → design system).',
            },
            {
              group: ['**/components/ui/*'],
              message: 'UI primitives live in packages/ui; import from @fenwira/ui.',
            },
          ],
        },
      ],
    },
  },
]
