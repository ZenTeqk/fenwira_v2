import { z } from 'zod'
import { PERMISSIONS, roleSchema } from '../rbac'
import { emailSchema, idSchema, passwordSchema } from './common'

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  country: z.string().length(2).toUpperCase().default('IN'),
  timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
})
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>

export const workspaceSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  country: z.string(),
  timezone: z.string(),
  currency: z.string(),
  require2fa: z.boolean(),
  createdAt: z.string(),
})
export type Workspace = z.infer<typeof workspaceSchema>

export const updateWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    country: z.string().length(2).toUpperCase(),
    timezone: z.string().min(1).max(64),
    require2fa: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field.')

export const transferOwnershipRequestSchema = z.object({ membershipId: idSchema })

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'DEACTIVATED'] as const
export const memberSchema = z.object({
  membershipId: idSchema,
  userId: idSchema,
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  status: z.enum(MEMBERSHIP_STATUSES),
  twoFactorEnabled: z.boolean(),
  joinedAt: z.string(),
})
export type Member = z.infer<typeof memberSchema>

export const updateMemberRequestSchema = z.object({ role: roleSchema.exclude(['OWNER']) })

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const
export const invitationSchema = z.object({
  id: idSchema,
  email: z.string(),
  role: roleSchema,
  status: z.enum(INVITATION_STATUSES),
  invitedByName: z.string(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Invitation = z.infer<typeof invitationSchema>

export const createInvitationRequestSchema = z.object({
  email: emailSchema,
  role: roleSchema.exclude(['OWNER']),
})
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>

export const invitationPreviewSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string(),
  email: z.string(),
  role: roleSchema,
  expiresAt: z.string(),
  existingAccount: z.boolean(),
})
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>

export const acceptInvitationRequestSchema = z.object({
  /** Only for a new account; existing users accept while signed in. */
  name: z.string().trim().min(1).max(100).optional(),
  password: passwordSchema.optional(),
})

export const roleMatrixSchema = z.object({
  roles: z.array(
    z.object({
      key: roleSchema,
      label: z.string(),
      rank: z.number(),
      permissions: z.array(z.string()),
    }),
  ),
  permissions: z.array(z.object({ key: z.string(), description: z.string() })),
})
export type RoleMatrix = z.infer<typeof roleMatrixSchema>

export const permissionKeySchema = z.enum(
  Object.keys(PERMISSIONS) as [keyof typeof PERMISSIONS, ...Array<keyof typeof PERMISSIONS>],
)
