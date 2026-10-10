/** Only same-app relative paths are allowed as post-login redirects (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return fallback
  return next
}
