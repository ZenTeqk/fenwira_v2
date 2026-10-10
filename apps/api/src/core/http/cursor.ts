import { AppError } from './app-error'

/** Opaque cursor over (createdAt, id) — docs/API_SPEC.md → Responses. */
export type Cursor = { createdAt: Date; id: string }

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url')
}

export function decodeCursor(cursor: string | undefined): Cursor | undefined {
  if (!cursor) return undefined
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      string,
      string,
    ]
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime()) || typeof id !== 'string') throw new Error('bad cursor')
    return { createdAt: date, id }
  } catch {
    throw new AppError('INVALID_CURSOR', 400, 'The pagination cursor is invalid.')
  }
}

/** Prisma `where` for rows strictly after the cursor in (createdAt desc, id desc) order. */
export function afterCursor(cursor: Cursor | undefined) {
  if (!cursor) return {}
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  }
}

export function toPage<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  return {
    items,
    page: { nextCursor: hasMore && last ? encodeCursor(last) : null, hasMore, limit },
  }
}
