/**
 * `{{…}}` expressions (docs/AUTOMATION_ENGINE.md → Expressions): a restricted path syntax, never
 * code. `{{contact.name}}`, `{{contact.firstName}}`, `{{contact.phone}}`, `{{contact.email}}`,
 * `{{contact.property.<key>}}`, `{{trigger.message.text}}`, `{{trigger.webhook.<path>}}` and
 * `{{vars.<name>.<path>}}`. A missing value is "".
 */
export type ExpressionContext = {
  contact?: Record<string, unknown> & { property?: Record<string, unknown> }
  trigger?: Record<string, unknown>
  vars?: Record<string, unknown>
}

const TOKEN = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g
const ROOTS = new Set(['contact', 'trigger', 'vars'])

/** Walks a dotted path through plain objects/arrays only. */
export function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

const stringify = (v: unknown): string =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)

/** Replaces every `{{path}}` with its value; unknown roots and missing values become "". */
export function evaluateExpression(text: string, ctx: ExpressionContext): string {
  return text.replace(TOKEN, (_, path: string) => {
    const root = path.split('.')[0]!
    if (!ROOTS.has(root)) return ''
    return stringify(getPath(ctx, path))
  })
}

/** Paths used by an expression (validation and the builder's chips). */
export const expressionPaths = (text: string): string[] =>
  [...text.matchAll(TOKEN)].map((m) => m[1]!)

export const isKnownRoot = (path: string) => ROOTS.has(path.split('.')[0]!)
