import { type AuditLog, auditQuerySchema, type Page } from '@fenwira/contracts'
import { Controller, Get, Query } from '@nestjs/common'
import { z } from 'zod'
import { TenantDb } from '../../core/database/tenant-db'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { AuditService } from './audit.service'

@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('audit.view')
  async list(
    @Query(new ZodValidationPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>,
  ): Promise<{ data: AuditLog[]; page: Page }> {
    const { items, page } = await this.db.run((tx) => this.audit.list(tx, query))
    return { data: items, page }
  }
}
