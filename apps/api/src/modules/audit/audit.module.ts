import { Global, Module } from '@nestjs/common'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'

/** Global so every module can append audit entries inside its own transactions. */
@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

/** API side: the audit log endpoint. */
@Module({ controllers: [AuditController] })
export class AuditApiModule {}
