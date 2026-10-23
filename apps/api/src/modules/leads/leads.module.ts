import { type DynamicModule, Module } from '@nestjs/common'
import { PlatformLeadsController, PublicLeadsController } from './leads.controller'
import { LEADS_TEAM_EMAIL, LEADS_WORKER_OPTIONS, type LeadsWorkerOptions } from './leads.options'
import { LeadsProcessor } from './leads.processor'
import { LeadsService } from './leads.service'

@Module({})
export class LeadsModule {
  /** API side: the public form endpoint and the operator list (needs PlatformGuard globally). */
  static forApi(): DynamicModule {
    return {
      module: LeadsModule,
      controllers: [PublicLeadsController, PlatformLeadsController],
      providers: [LeadsService],
    }
  }

  /** Worker side: lead emails. Requires EmailModule (global) in the worker. */
  static forWorker(options: Pick<LeadsWorkerOptions, 'webOrigin'>): DynamicModule {
    return {
      module: LeadsModule,
      providers: [
        { provide: LEADS_WORKER_OPTIONS, useValue: { teamEmail: LEADS_TEAM_EMAIL, ...options } },
        LeadsProcessor,
      ],
      exports: [LeadsProcessor],
    }
  }
}
