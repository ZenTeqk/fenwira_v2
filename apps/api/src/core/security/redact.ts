/** Recursive defense in depth; commercial DTOs still use explicit field allowlists. */
const SENSITIVE =
  /password|token|secret|code|phone|email|body|content|variables|credential|authorization|cookie/i
export function redactAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAudit)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SENSITIVE.test(key) ? '[REDACTED]' : redactAudit(child),
      ]),
    )
  if (typeof value === 'string')
    return value.replace(/Bearer\s+\S+|fw_[A-Za-z0-9]+_[A-Za-z0-9_-]+/gi, '[REDACTED]')
  return value
}
