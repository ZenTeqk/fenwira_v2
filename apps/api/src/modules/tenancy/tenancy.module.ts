import { type DynamicModule, Module } from '@nestjs/common'
import { InvitationService } from './invitation.service'
import { MeService } from './me.service'
import { PermissionGuard } from './permission.guard'
import {
  MeController,
  PublicInvitationController,
  RolesController,
  TeamController,
  WorkspaceController,
} from './tenancy.controllers'
import { TENANCY_WORKER_OPTIONS, TenancyProcessor } from './tenancy.processor'
import { TeamService } from './team.service'
import { TenantAccessService } from './tenant-access.service'
import { TenantGuard } from './tenant.guard'
import { WorkspaceService } from './workspace.service'

@Module({})
export class TenancyModule {
  /** API side. Requires IdentityModule.forApi in the same application (imports passed in). */
  static forApi(identity: DynamicModule): DynamicModule {
    return {
      module: TenancyModule,
      imports: [identity],
      controllers: [
        MeController,
        WorkspaceController,
        TeamController,
        RolesController,
        PublicInvitationController,
      ],
      providers: [
        WorkspaceService,
        TeamService,
        InvitationService,
        MeService,
        TenantAccessService,
        TenantGuard,
        PermissionGuard,
      ],
      exports: [TenantGuard, PermissionGuard, MeService, TenantAccessService],
    }
  }

  /** Worker side: invitation emails. Requires EmailModule (global). */
  static forWorker(options: { webOrigin: string }): DynamicModule {
    return {
      module: TenancyModule,
      providers: [{ provide: TENANCY_WORKER_OPTIONS, useValue: options }, TenancyProcessor],
      exports: [TenancyProcessor],
    }
  }
}
