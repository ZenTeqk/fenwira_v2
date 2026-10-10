// Shared ESLint flat config for every Fenwira package and app.
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export const ignores = {
  ignores: [
    '**/dist/**',
    '**/.next/**',
    '**/generated/**',
    '**/coverage/**',
    '**/next-env.d.ts',
    '**/*.config.{js,mjs,cjs}',
  ],
}

export default tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'error',
      // AGENTS.md rule 1: the raw Prisma client never leaves packages/database.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'Use @fenwira/database (withTenant / system gateway) instead.',
            },
            {
              name: '@fenwira/database/internal',
              message: 'Internal Prisma access is restricted to packages/database and tests.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/test/**', '**/*.test.ts', '**/*.int.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettier,
)

/**
 * NestJS packages: constructor parameter types are runtime DI tokens (emitDecoratorMetadata),
 * so they must stay value imports. Telling the parser lets consistent-type-imports respect that.
 */
export const nest = [
  {
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
]
