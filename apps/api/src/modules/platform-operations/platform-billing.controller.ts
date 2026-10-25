import {
  approvePaymentRequestSchema,
  createInvoiceRequestSchema,
  rejectPaymentRequestSchema,
  voidInvoiceRequestSchema,
  type ApprovePaymentRequest,
  type CreateInvoiceRequest,
} from '@fenwira/contracts'
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess } from '../../core/security/decorators'
import { CommercialOperationService } from './commercial-operation.service'
import { PlatformBillingService } from './platform-billing.service'

const uuid = new ZodValidationPipe(z.uuid())

/** ADR-0027 manual UPI billing, operator side (docs/API_SPEC.md → Platform billing). */
@Controller('platform')
export class PlatformBillingController {
  constructor(
    private readonly reads: PlatformBillingService,
    private readonly operations: CommercialOperationService,
  ) {}

  @PlatformAccess('payments.read')
  @Get('billing/dashboard')
  async dashboard() {
    return { data: await this.reads.dashboard() }
  }

  @PlatformAccess('payments.read')
  @Get('workspaces/:workspaceId/invoices')
  async invoices(@Param('workspaceId', uuid) workspaceId: string) {
    return { data: await this.reads.invoices(workspaceId) }
  }

  @PlatformAccess('payments.manage')
  @Post('workspaces/:workspaceId/invoices')
  @HttpCode(201)
  async issue(
    @Param('workspaceId', uuid) workspaceId: string,
    @Body(new ZodValidationPipe(createInvoiceRequestSchema)) body: CreateInvoiceRequest,
  ) {
    return { data: await this.operations.issueInvoice(workspaceId, body) }
  }

  @PlatformAccess('payments.manage')
  @Post('workspaces/:workspaceId/invoices/remind')
  @HttpCode(200)
  async remind(@Param('workspaceId', uuid) workspaceId: string) {
    return { data: await this.reads.remind(workspaceId) }
  }

  @PlatformAccess('payments.manage')
  @Post('workspaces/:workspaceId/invoices/:invoiceId/void')
  @HttpCode(200)
  async void(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('invoiceId', uuid) invoiceId: string,
    @Body(new ZodValidationPipe(voidInvoiceRequestSchema)) body: { reason: string },
  ) {
    return { data: await this.operations.voidInvoice(workspaceId, invoiceId, body.reason) }
  }

  @PlatformAccess('payments.read')
  @Get('workspaces/:workspaceId/payment-proofs/:proofId/file')
  async file(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('proofId', uuid) proofId: string,
  ) {
    return { data: await this.reads.proofFile(workspaceId, proofId) }
  }

  @PlatformAccess('payments.manage')
  @Post('workspaces/:workspaceId/payment-proofs/:proofId/approve')
  @HttpCode(200)
  async approve(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('proofId', uuid) proofId: string,
    @Body(new ZodValidationPipe(approvePaymentRequestSchema)) body: ApprovePaymentRequest,
  ) {
    return { data: await this.operations.approvePayment(workspaceId, proofId, body) }
  }

  @PlatformAccess('payments.manage')
  @Post('workspaces/:workspaceId/payment-proofs/:proofId/reject')
  @HttpCode(200)
  async reject(
    @Param('workspaceId', uuid) workspaceId: string,
    @Param('proofId', uuid) proofId: string,
    @Body(new ZodValidationPipe(rejectPaymentRequestSchema)) body: { reason: string },
  ) {
    return { data: await this.operations.rejectPayment(workspaceId, proofId, body.reason) }
  }
}
