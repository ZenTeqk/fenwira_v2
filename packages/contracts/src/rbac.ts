import { z } from 'zod'

/**
 * Roles and permission catalog — the single source of truth (docs/SECURITY.md → RBAC).
 * Seeded into the roles/permissions tables by the migrate step; guards check permission keys,
 * never role names (except OWNER-only actions).
 */
export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const
export const roleSchema = z.enum(ROLES)
export type Role = z.infer<typeof roleSchema>

/** Higher rank can manage lower ranks; nobody can grant a role above their own. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 50,
  ADMIN: 40,
  MANAGER: 30,
  AGENT: 20,
  VIEWER: 10,
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  AGENT: 'Agent',
  VIEWER: 'Viewer',
}

export const PERMISSIONS = {
  'workspace.read': 'View workspace settings',
  'workspace.manage': 'Change workspace name, timezone and security settings',
  'workspace.delete': 'Delete the workspace',
  'workspace.transfer': 'Transfer workspace ownership',
  'team.read': 'View team members',
  'team.manage': 'Invite members, change roles, deactivate members',
  'roles.read': 'View the role and permission matrix',
  'whatsapp.read': 'View WhatsApp connections',
  'whatsapp.manage': 'Connect, manage and disconnect WhatsApp numbers',
  'contacts.read': 'View contacts',
  'contacts.write': 'Create and edit contacts, tags, notes and segments',
  'contacts.delete': 'Delete contacts',
  'contacts.import': 'Import contacts',
  'contacts.export': 'Export contacts',
  'contacts.properties.manage': 'Manage custom contact fields',
  'inbox.read': 'View conversations',
  'inbox.reply': 'Reply to conversations',
  'inbox.assign_self': 'Assign conversations to yourself',
  'inbox.reassign': 'Assign conversations to anyone',
  'inbox.read_all': 'See conversations assigned to others',
  'templates.read': 'View message templates',
  'templates.write': 'Create and edit templates',
  'templates.submit': 'Submit templates to Meta',
  'campaigns.read': 'View campaigns',
  'campaigns.write': 'Create and edit draft campaigns',
  'campaigns.launch': 'Launch, pause, resume, stop and retry campaigns',
  'automations.read': 'View automations',
  'automations.write': 'Build automations',
  'automations.publish': 'Publish, pause and cancel automations',
  'analytics.read': 'View analytics',
  'billing.read': 'View billing',
  'billing.manage': 'Change plan and manage the wallet',
  'integrations.manage': 'Manage API keys and webhooks',
  'audit.view': 'View the audit log',
} as const

export type Permission = keyof typeof PERMISSIONS
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[]

const all = PERMISSION_KEYS
const except = (...excluded: Permission[]) => all.filter((p) => !excluded.includes(p))

/** The matrix in docs/SECURITY.md, verbatim. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: all,
  ADMIN: except('workspace.delete', 'workspace.transfer', 'billing.manage'),
  MANAGER: [
    'workspace.read',
    'team.read',
    'roles.read',
    'whatsapp.read',
    'contacts.read',
    'contacts.write',
    'contacts.delete',
    'contacts.import',
    'contacts.export',
    'inbox.read',
    'inbox.reply',
    'inbox.assign_self',
    'inbox.reassign',
    'inbox.read_all',
    'templates.read',
    'templates.write',
    'templates.submit',
    'campaigns.read',
    'campaigns.write',
    'campaigns.launch',
    'automations.read',
    'automations.write',
    'analytics.read',
  ],
  AGENT: [
    'workspace.read',
    'team.read',
    'whatsapp.read',
    'contacts.read',
    'contacts.write',
    'inbox.read',
    'inbox.reply',
    'inbox.assign_self',
    'inbox.read_all',
    'templates.read',
    'campaigns.read',
    'automations.read',
  ],
  VIEWER: [
    'workspace.read',
    'team.read',
    'whatsapp.read',
    'contacts.read',
    'inbox.read',
    'inbox.read_all',
    'templates.read',
    'campaigns.read',
    'automations.read',
    'analytics.read',
  ],
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

/** Whether `actor` may assign `target` (never above your own rank; OWNER only via transfer). */
export function canAssignRole(actor: Role, target: Role): boolean {
  return target !== 'OWNER' && ROLE_RANK[target] <= ROLE_RANK[actor]
}
