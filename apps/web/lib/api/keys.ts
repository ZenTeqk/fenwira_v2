/**
 * Query keys. Everything tenant-scoped is keyed by tenant id first, and switching tenant also
 * clears the whole cache — two independent guarantees against showing another tenant's data.
 */
export const keys = {
  me: ['me'] as const,
  tenant: (tenantId: string | undefined, ...rest: string[]) =>
    ['tenant', tenantId ?? 'none', ...rest] as const,
  sessions: ['me', 'sessions'] as const,
  securityEvents: ['me', 'security-events'] as const,
}
