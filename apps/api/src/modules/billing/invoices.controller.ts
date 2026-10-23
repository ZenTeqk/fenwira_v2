import {
  paymentProofUploadRequestSchema,
  submitPaymentProofRequestSchema,
  type PaymentProofUploadRequest,
  type SubmitPaymentProofRequest,
} from '@fenwira/contracts'
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Res } from '@nestjs/common'
import { type Response } from 'express'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { RequirePermission } from '../../core/security/decorators'
import { InvoicesService } from './invoices.service'

const uuid = new ZodValidationPipe(z.uuid())
const downloadQuery = new ZodValidationPipe(z.object({ download: z.enum(['1']).optional() }))

/** ADR-0027 manual UPI billing, customer side (docs/API_SPEC.md → Invoices). */
@Controller('billing/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('billing.read')
  async list() {
    return { data: await this.invoices.list() }
  }

  @Get(':id')
  @RequirePermission('billing.read')
  async get(@Param('id', uuid) id: string) {
    return { data: await this.invoices.get(id) }
  }

  @Get(':id/document')
  @RequirePermission('billing.read')
  @Header('Cache-Control', 'no-store')
  async document(
    @Param('id', uuid) id: string,
    @Query(downloadQuery) q: { download?: '1' },
    @Res() res: Response,
  ) {
    this.sendHtml(
      res,
      await this.invoices.document(id, 'request'),
      q.download,
      `payment-request-${id}`,
    )
  }

  @Get(':id/receipt')
  @RequirePermission('billing.read')
  @Header('Cache-Control', 'no-store')
  async receipt(
    @Param('id', uuid) id: string,
    @Query(downloadQuery) q: { download?: '1' },
    @Res() res: Response,
  ) {
    this.sendHtml(res, await this.invoices.document(id, 'receipt'), q.download, `receipt-${id}`)
  }

  @Post(':id/proof-uploads')
  @RequirePermission('billing.manage')
  @HttpCode(201)
  async upload(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(paymentProofUploadRequestSchema)) body: PaymentProofUploadRequest,
  ) {
    return { data: await this.invoices.createProofUpload(id, body) }
  }

  @Post(':id/proofs')
  @RequirePermission('billing.manage')
  @HttpCode(201)
  async submit(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(submitPaymentProofRequestSchema)) body: SubmitPaymentProofRequest,
  ) {
    return { data: await this.invoices.submitProof(id, body) }
  }

  /** Self-contained HTML (no scripts); a strict CSP keeps it inert even if opened directly. */
  private sendHtml(res: Response, html: string, download: string | undefined, name: string) {
    res
      .status(200)
      .type('text/html; charset=utf-8')
      .setHeader(
        'Content-Security-Policy',
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      )
      .setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${name}.html"`,
      )
      .send(html)
  }
}
