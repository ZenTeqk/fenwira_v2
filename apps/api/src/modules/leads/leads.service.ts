import { uuidv7 } from '@fenwira/config'
import { type AccessRequestInput, type AccessRequestItem } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { requestContext } from '../../core/context/request-context'
import { RateLimitService } from '../../core/security/rate-limit.service'

/** docs/SECURITY.md → Rate limits: strict per IP, plus a global cap against distributed floods. */
export const ACCESS_REQUEST_LIMITS = { perIpPerHour: 5, globalPerHour: 200 }

/**
 * Request access leads (docs/API_SPEC.md → Public). The row and its outbox event are written in
 * one transaction, so the lead survives an email failure. Logs carry only the request id.
 */
@Injectable()
export class LeadsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly limits: RateLimitService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('LeadsService')
  }

  async submit(input: AccessRequestInput): Promise<void> {
    const ip = requestContext.get()?.ip ?? 'unknown'
    await this.limits.consume([
      {
        bucket: 'access-request:ip',
        key: ip,
        limit: ACCESS_REQUEST_LIMITS.perIpPerHour,
        windowSeconds: 3600,
      },
      {
        bucket: 'access-request:global',
        key: 'all',
        limit: ACCESS_REQUEST_LIMITS.globalPerHour,
        windowSeconds: 3600,
      },
    ])
    // Honeypot: a bot filled the hidden field. Same 200 as a real request, nothing stored.
    if (input.website) {
      this.logger.info('access request dropped (honeypot)')
      return
    }
    const id = uuidv7()
    await this.db.withGlobal(async (tx) => {
      await tx.accessRequest.create({
        data: {
          id,
          name: input.name,
          company: input.company,
          email: input.email,
          phone: input.phone,
          volume: input.volume,
        },
      })
      await this.db.system.emitPlatformEvent(
        'leads.access_request.submitted',
        { accessRequestId: id },
        requestContext.correlationId() ?? null,
        tx,
      )
    })
    this.logger.info({ accessRequestId: id }, 'access request stored')
  }

  /** Operator console: newest first. */
  async list(): Promise<AccessRequestItem[]> {
    const rows = await this.db.withGlobal((tx) =>
      tx.accessRequest.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 }),
    )
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      company: r.company,
      email: r.email,
      phone: r.phone,
      volume: r.volume,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }))
  }
}
