import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  type RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common'
import { type Request, type Response } from 'express'
import { AppError } from '../../core/http/app-error'
import { MetricsService } from '../../core/metrics/metrics.service'
import { Public, SkipCsrf } from '../../core/security/decorators'
import { WebhookIngestService } from './webhook-ingest.service'

/**
 * Meta → Fenwira. Public: authenticity comes from the X-Hub-Signature-256 HMAC, made with the app
 * secret of the WABA the payload belongs to, or the platform app secret (ML-D1, ADR-0027).
 */
@Controller('webhooks/whatsapp')
@Public()
@SkipCsrf()
export class WhatsAppWebhookController {
  constructor(
    private readonly ingest: WebhookIngestService,
    private readonly metrics: MetricsService,
  ) {}

  /** Meta's subscription handshake: echo hub.challenge when the verify token matches. */
  @Get()
  handshake(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    if (!this.ingest.verifyHandshake(mode, token) || !challenge) {
      res.status(403).type('text/plain').send('Forbidden')
      return
    }
    res.status(200).type('text/plain').send(challenge)
  }

  /** Always a fast 200 once events are durable; 401 (nothing stored) on a bad signature. */
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Body() body: unknown) {
    const end = this.metrics.webhookIngestDuration.startTimer()
    const signedWith = await this.ingest.verifiedSecret(
      req.rawBody,
      req.header('x-hub-signature-256'),
      body,
    )
    if (!signedWith) {
      this.metrics.webhookReceived.inc({ kind: 'unknown', result: 'bad_signature' })
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid signature.')
    }
    try {
      return await this.ingest.ingest(body, signedWith)
    } finally {
      end()
    }
  }
}
