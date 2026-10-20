/**
 * Escapes LIKE/ILIKE metacharacters so user text matches literally.
 *
 * Prisma compiles `contains`, `startsWith`, `endsWith` and case-insensitive `equals` to Postgres
 * LIKE/ILIKE without escaping, so a search for `%` or `_` matched every row and a trailing
 * backslash was an invalid pattern (500). Wrap every user-supplied value passed to those operators
 * (and to hand-written LIKE patterns) in likeLiteral(). Backslash is Postgres' default escape.
 */
export function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}
