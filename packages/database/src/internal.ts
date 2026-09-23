// Raw Prisma access for packages/database itself and tests only (ESLint forbids other imports).
export { createPrismaClient } from './client'
export { Prisma, PrismaClient } from '@prisma/client'
export { POST_MIGRATE_SQL_PATH, PRISMA_SCHEMA_PATH } from './paths'
