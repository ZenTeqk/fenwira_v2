import base from '@fenwira/config/eslint'

// packages/database is the one place allowed to touch the raw Prisma client.
export default [
  ...base,
  { rules: { 'no-restricted-imports': 'off', 'no-console': 'off' }, files: ['src/**'] },
]
