import { uuidv7 } from '@fenwira/config'
import { type NextFunction, type Request, type Response } from 'express'
import { requestContext } from '../context/request-context'

export const CORRELATION_HEADER = 'x-correlation-id'
/** Accept a client-supplied id only if it is a short, safe token (UUIDs included). */
const ACCEPTABLE_ID = /^[A-Za-z0-9._:-]{1,64}$/

export function resolveCorrelationId(incoming: string | undefined): string {
  return incoming && ACCEPTABLE_ID.test(incoming) ? incoming : uuidv7()
}

/**
 * First middleware on every request: resolve the correlation id, echo it on the response,
 * and run the rest of the request inside the async context the logger reads.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = resolveCorrelationId(req.header(CORRELATION_HEADER))
  ;(req as Request & { correlationId: string }).correlationId = correlationId
  res.setHeader('X-Correlation-Id', correlationId)
  requestContext.run({ correlationId }, next)
}
