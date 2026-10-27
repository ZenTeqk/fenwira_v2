/**
 * Unsent composer text per conversation (docs/INBOX.md → Drafts). Kept in memory and mirrored to
 * sessionStorage so a refresh keeps it; scoped to one user in one workspace, never shared across
 * accounts. Reply and internal-note drafts are separate. Cleared after a successful send, and
 * entirely on sign-out and workspace switch.
 */
export type DraftMode = 'reply' | 'note'
type Drafts = Record<string, Partial<Record<DraftMode, string>>>

const PREFIX = 'fenwira.drafts.'
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export function createDraftStore(storage: () => Store | null) {
  const memory = new Map<string, Drafts>()
  const safe = <T>(fn: (s: Store) => T): T | undefined => {
    try {
      const s = storage()
      return s ? fn(s) : undefined
    } catch {
      return undefined // Storage blocked or full: memory still works for this page.
    }
  }
  const load = (scope: string): Drafts => {
    let drafts = memory.get(scope)
    if (!drafts) {
      const raw = safe((s) => s.getItem(PREFIX + scope))
      try {
        drafts = raw ? (JSON.parse(raw) as Drafts) : {}
      } catch {
        drafts = {}
      }
      memory.set(scope, drafts)
    }
    return drafts
  }
  const save = (scope: string, drafts: Drafts) => {
    memory.set(scope, drafts)
    safe((s) =>
      Object.keys(drafts).length
        ? s.setItem(PREFIX + scope, JSON.stringify(drafts))
        : s.removeItem(PREFIX + scope),
    )
  }
  return {
    get(scope: string, conversationId: string, mode: DraftMode): string {
      return load(scope)[conversationId]?.[mode] ?? ''
    },
    set(scope: string, conversationId: string, mode: DraftMode, text: string) {
      const drafts = { ...load(scope) }
      const entry = { ...drafts[conversationId] }
      if (text) entry[mode] = text
      else delete entry[mode]
      if (Object.keys(entry).length) drafts[conversationId] = entry
      else delete drafts[conversationId]
      save(scope, drafts)
    },
    clear(scope: string, conversationId: string, mode: DraftMode) {
      this.set(scope, conversationId, mode, '')
    },
    /** Sign-out and workspace switch: every draft of every scope. */
    clearAll() {
      memory.clear()
      safe((s) => {
        const keys: string[] = []
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i)
          if (k?.startsWith(PREFIX)) keys.push(k)
        }
        for (const k of keys) s.removeItem(k)
      })
    },
  }
}

export const drafts = createDraftStore(() =>
  typeof window === 'undefined' ? null : window.sessionStorage,
)
export const draftScope = (userId: string, tenantId: string) => `${userId}.${tenantId}`
