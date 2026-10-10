export type ApiKeysOptions = {
  /** Mixed into every key hash (docs/API_KEYS.md → Storage). Never logged. */
  pepper: string
  /** Requests per key per minute. */
  rateLimitPerMinute: number
}
export const API_KEYS_OPTIONS = Symbol('API_KEYS_OPTIONS')
