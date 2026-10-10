import { describe, expect, it } from 'vitest'
import {
  canAssignRole,
  PERMISSION_KEYS,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  ROLES,
  roleHasPermission,
} from '../src'

describe('RBAC matrix', () => {
  it('gives OWNER every permission and only known keys to every role', () => {
    expect([...ROLE_PERMISSIONS.OWNER].sort()).toEqual([...PERMISSION_KEYS].sort())
    for (const role of ROLES)
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSION_KEYS).toContain(p)
  })

  // Documented inversion (docs/SECURITY.md): VIEWER is a reporting stakeholder, so it reads
  // analytics while AGENT (inbox work) does not. Any other inversion is a matrix bug.
  const ALLOWED_INVERSIONS = new Set(['VIEWER>AGENT:analytics.read'])

  it('is monotonic apart from documented inversions', () => {
    const byRank = [...ROLES].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])
    for (let i = 1; i < byRank.length; i++) {
      const [upper, lower] = [byRank[i - 1]!, byRank[i]!]
      const higher = new Set(ROLE_PERMISSIONS[upper])
      for (const p of ROLE_PERMISSIONS[lower]) {
        if (ALLOWED_INVERSIONS.has(`${lower}>${upper}:${p}`)) continue
        expect(higher.has(p), `${lower} has ${p} but ${upper} does not`).toBe(true)
      }
    }
  })

  it('keeps OWNER-only and admin-only capabilities where SECURITY.md puts them', () => {
    expect(roleHasPermission('ADMIN', 'workspace.delete')).toBe(false)
    expect(roleHasPermission('ADMIN', 'billing.manage')).toBe(false)
    expect(roleHasPermission('ADMIN', 'team.manage')).toBe(true)
    expect(roleHasPermission('MANAGER', 'team.manage')).toBe(false)
    expect(roleHasPermission('MANAGER', 'automations.publish')).toBe(false)
    expect(roleHasPermission('AGENT', 'roles.read')).toBe(false)
    expect(roleHasPermission('AGENT', 'inbox.reply')).toBe(true)
    expect(roleHasPermission('VIEWER', 'inbox.reply')).toBe(false)
    expect(roleHasPermission('VIEWER', 'analytics.read')).toBe(true)
  })

  it('matches decision I3 for canned replies: managers and up manage, agents only use', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const) {
      expect(roleHasPermission(role, 'inbox.canned_replies.manage')).toBe(true)
      expect(roleHasPermission(role, 'inbox.reply')).toBe(true)
    }
    expect(roleHasPermission('AGENT', 'inbox.canned_replies.manage')).toBe(false)
    expect(roleHasPermission('AGENT', 'inbox.reply')).toBe(true)
    expect(roleHasPermission('VIEWER', 'inbox.canned_replies.manage')).toBe(false)
    expect(roleHasPermission('VIEWER', 'inbox.reply')).toBe(false)
  })

  it('never lets anyone assign OWNER or a role above their own', () => {
    expect(canAssignRole('OWNER', 'ADMIN')).toBe(true)
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(true)
    expect(canAssignRole('ADMIN', 'OWNER')).toBe(false)
    expect(canAssignRole('MANAGER', 'ADMIN')).toBe(false)
    expect(canAssignRole('OWNER', 'OWNER')).toBe(false)
  })
})
