import { PrismaClient } from '@prisma/client'

export type CreatePrismaClientOptions = {
  url: string
  poolSize?: number
}

/** Raw client factory. Only packages/database (and tests via ./internal) may use it — ADR-0016. */
export function createPrismaClient({ url, poolSize }: CreatePrismaClientOptions): PrismaClient {
  const datasourceUrl = new URL(url)
  if (poolSize) datasourceUrl.searchParams.set('connection_limit', String(poolSize))
  return new PrismaClient({ datasourceUrl: datasourceUrl.toString() })
}
