import {
  createWorkspaceWithOwnerSchema,
  deleteWorkspaceRequestSchema,
  restoreWorkspaceRequestSchema,
  type CreateWorkspaceWithOwner,
  type DeleteWorkspaceRequest,
  type RestoreWorkspaceRequest,
} from '@fenwira/contracts'
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess } from '../../core/security/decorators'
import { PlatformAccountsService } from './platform-accounts.service'

const uuid = new ZodValidationPipe(z.uuid())

/** ADR-0027 step 4: provisioning without email (docs/API_SPEC.md → Platform accounts). */
@Controller('platform')
export class PlatformAccountsController {
  constructor(private readonly accounts: PlatformAccountsService) {}

  @PlatformAccess('workspaces.manage')
  @Post('workspaces/provision')
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createWorkspaceWithOwnerSchema)) body: CreateWorkspaceWithOwner,
  ) {
    return { data: await this.accounts.createWorkspace(body) }
  }

  @PlatformAccess('workspaces.manage')
  @Post('workspaces/:workspaceId/delete')
  @HttpCode(204)
  async remove(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body(new ZodValidationPipe(deleteWorkspaceRequestSchema)) body: DeleteWorkspaceRequest,
  ) {
    await this.accounts.deleteWorkspace(workspaceId, body)
  }

  @PlatformAccess('commercial.read')
  @Get('deleted-workspaces')
  async deleted() {
    return { data: await this.accounts.deletedWorkspaces() }
  }

  @PlatformAccess('workspaces.manage')
  @Post('workspaces/:workspaceId/restore')
  @HttpCode(204)
  async restore(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body(new ZodValidationPipe(restoreWorkspaceRequestSchema)) body: RestoreWorkspaceRequest,
  ) {
    await this.accounts.restoreWorkspace(workspaceId, body)
  }

  @PlatformAccess('commercial.read')
  @Get('workspaces/:workspaceId/members')
  async members(@Param('workspaceId', uuid) workspaceId: string) {
    return { data: await this.accounts.members(workspaceId) }
  }

  @PlatformAccess('workspaces.manage')
  @Post('workspaces/:workspaceId/members/:userId/reset-link')
  @HttpCode(200)
  async resetLink(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('userId', uuid) userId: string,
  ) {
    return { data: await this.accounts.resetLink(workspaceId, userId) }
  }

  @PlatformAccess('audit.read')
  @Get('email-deliveries')
  async deliveries() {
    return { data: await this.accounts.emailDeliveries() }
  }
}
