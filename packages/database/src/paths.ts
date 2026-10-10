import { join } from 'node:path'

/** Package root, from either src/ (tests) or dist/ (runtime). */
export const PACKAGE_ROOT = join(__dirname, '..')
export const PRISMA_SCHEMA_PATH = join(PACKAGE_ROOT, 'prisma', 'schema.prisma')
export const POST_MIGRATE_SQL_PATH = join(PACKAGE_ROOT, 'sql', 'post-migrate.sql')
