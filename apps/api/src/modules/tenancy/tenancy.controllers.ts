import {
  acceptInvitationRequestSchema,
  createInvitationRequestSchema,
  createWorkspaceRequestSchema,
  type Invitation,
  type InvitationPreview,
  type Me,
  type Member,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  type RoleMatrix,
  ROLES,
  transferOwnershipRequestSchema,
  updateMemberRequestSchema,
  updateWorkspaceRequestSchema,
  type Workspace,
} from '@fenwira/contracts'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import { type Request, type Response } from 'express'
import { CORE_CONFIG, type CoreConfig } from '../../core/config/core-config'
import { randomToken } from '@fenwira/config'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { CSRF_COOKIE, setSessionCookies } from '../../core/security/cookies'
import {
  OptionalAuth,
  Public,
  RequirePermission,
  RequireRole,
} from '../../core/security/decorators'
import { currentAuth, IDENTITY_OPTIONS, type IdentityOptions, IdentityService } from '../identity'
import { InvitationService } from './invitation.service'
import { MeService } from './me.service'
import { TeamService } from './team.service'
import { WorkspaceService } from './workspace.service'

const uuidParam = new ZodValidationPipe(z.uuid())
const tokenParam = new ZodValidationPipe(z.string().min(20).max(200))

@Controller()
export class MeController {
  constructor(
    private readonly identity: IdentityService,
    private readonly me: MeService,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
  ) {}

  /** User, workspaces, product switches and the CSRF token for this browser session. */
  @Get('auth/me')
  async get(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ data: Me }> {
    const { userId } = currentAuth()
    const [user, memberships] = await Promise.all([
      this.identity.getUser(userId),
      this.me.memberships(userId),
    ])
    let csrfToken = (req.cookies as Record<string, string | undefined>)[CSRF_COOKIE]
    if (!csrfToken) {
      csrfToken = randomToken()
      res.cookie(CSRF_COOKIE, csrfToken, {
        httpOnly: true,
        secure: this.options.cookies.secure,
        sameSite: 'lax',
        path: '/',
        ...(this.options.cookies.domain ? { domain: this.options.cookies.domain } : {}),
      })
    }
    const features = { managedLaunch: this.config.features?.managedLaunch ?? false }
    return { data: { user, memberships, csrfToken, features } }
  }
}

@Controller()
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Post('tenants')
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createWorkspaceRequestSchema))
    body: z.infer<typeof createWorkspaceRequestSchema>,
  ): Promise<{ data: Workspace }> {
    return { data: await this.workspaces.create(body) }
  }

  @Get('workspace')
  @RequirePermission('workspace.read')
  async get(): Promise<{ data: Workspace }> {
    return { data: await this.workspaces.get() }
  }

  @Patch('workspace')
  @RequirePermission('workspace.manage')
  async update(
    @Body(new ZodValidationPipe(updateWorkspaceRequestSchema))
    body: z.infer<typeof updateWorkspaceRequestSchema>,
  ): Promise<{ data: Workspace }> {
    return { data: await this.workspaces.update(body) }
  }

  @Delete('workspace')
  @RequireRole('OWNER')
  @HttpCode(204)
  async remove(): Promise<void> {
    await this.workspaces.remove()
  }

  @Post('workspace/transfer-ownership')
  @RequireRole('OWNER')
  @HttpCode(204)
  async transfer(
    @Body(new ZodValidationPipe(transferOwnershipRequestSchema)) body: { membershipId: string },
  ): Promise<void> {
    await this.workspaces.transferOwnership(body.membershipId)
  }
}

@Controller('team')
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly invitations: InvitationService,
  ) {}

  @Get('members')
  @RequirePermission('team.read')
  async members(): Promise<{ data: Member[] }> {
    return { data: await this.team.list() }
  }

  @Patch('members/:id')
  @RequirePermission('team.manage')
  @HttpCode(204)
  async changeRole(
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateMemberRequestSchema))
    body: z.infer<typeof updateMemberRequestSchema>,
  ): Promise<void> {
    await this.team.changeRole(id, body.role)
  }

  @Post('members/:id/deactivate')
  @RequirePermission('team.manage')
  @HttpCode(204)
  async deactivate(@Param('id', uuidParam) id: string): Promise<void> {
    await this.team.setActive(id, false)
  }

  @Post('members/:id/reactivate')
  @RequirePermission('team.manage')
  @HttpCode(204)
  async reactivate(@Param('id', uuidParam) id: string): Promise<void> {
    await this.team.setActive(id, true)
  }

  @Get('invitations')
  @RequirePermission('team.manage')
  async listInvitations(): Promise<{ data: Invitation[] }> {
    return { data: await this.invitations.list() }
  }

  @Post('invitations')
  @RequirePermission('team.manage')
  @HttpCode(201)
  async invite(
    @Body(new ZodValidationPipe(createInvitationRequestSchema))
    body: z.infer<typeof createInvitationRequestSchema>,
  ): Promise<{ data: Invitation }> {
    return { data: await this.invitations.create(body) }
  }

  @Post('invitations/:id/resend')
  @RequirePermission('team.manage')
  @HttpCode(202)
  async resend(@Param('id', uuidParam) id: string) {
    return { data: await this.invitations.resend(id) }
  }

  @Post('invitations/:id/revoke')
  @RequirePermission('team.manage')
  @HttpCode(204)
  async revoke(@Param('id', uuidParam) id: string): Promise<void> {
    await this.invitations.revoke(id)
  }
}

@Controller('roles')
export class RolesController {
  @Get()
  @RequirePermission('roles.read')
  matrix(): { data: RoleMatrix } {
    return {
      data: {
        roles: ROLES.map((key) => ({
          key,
          label: ROLE_LABELS[key],
          rank: ROLE_RANK[key],
          permissions: [...ROLE_PERMISSIONS[key]],
        })),
        permissions: Object.entries(PERMISSIONS).map(([key, description]) => ({
          key,
          description,
        })),
      },
    }
  }
}

/** Public endpoints for invitation links (the token is the credential). */
@Controller('invitations')
export class PublicInvitationController {
  constructor(
    private readonly invitations: InvitationService,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
  ) {}

  @Public()
  @Get(':token')
  async preview(@Param('token', tokenParam) token: string): Promise<{ data: InvitationPreview }> {
    return { data: await this.invitations.preview(token) }
  }

  @Public()
  @OptionalAuth()
  @Post(':token/accept')
  @HttpCode(200)
  async accept(
    @Param('token', tokenParam) token: string,
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema))
    body: z.infer<typeof acceptInvitationRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: { tenantId: string; csrfToken?: string } }> {
    const result = await this.invitations.accept(token, body)
    if (result.tokens) setSessionCookies(res, this.options.cookies, result.tokens)
    return { data: { tenantId: result.tenantId, csrfToken: result.tokens?.csrfToken } }
  }
}
