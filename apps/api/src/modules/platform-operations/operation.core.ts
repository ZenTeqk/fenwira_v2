import { createHash } from 'node:crypto'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { redactAudit } from '../../core/security/redact'

export function commercialJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue
}
export function fingerprint(value: unknown): string {
  const ordered = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordered)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, child]) => [k, ordered(child)]),
          )
        : v
  return createHash('sha256')
    .update(JSON.stringify(ordered(commercialJson(value))))
    .digest('hex')
}
export type OperationInput = {
  kind: string
  reason: string
  reference: string
  idempotencyKey: string
  amountMinor?: number
  currency?: string
  expectedVersion?: string
}

/** Serialize a logical operation before checking its immutable receipt; domain locking follows. */
export async function commercialOperation(
  tx: TenantTx,
  tenantId: string,
  operatorId: string,
  input: OperationInput,
  snapshot: () => Promise<Prisma.InputJsonValue>,
  mutate: () => Promise<Prisma.InputJsonValue>,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:commercial:${input.idempotencyKey}`}))`
  const hash = fingerprint(input)
  const previous = await tx.commercialOperation.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
  })
  if (previous) {
    if (previous.requestHash !== hash)
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        409,
        'This idempotency key belongs to a different operation.',
      )
    return previous
  }
  const before = await snapshot()
  if (input.expectedVersion && fingerprint(before) !== input.expectedVersion)
    throw new AppError('VERSION_CONFLICT', 409, 'Commercial state changed. Review a fresh preview.')
  const result = await mutate(),
    after = await snapshot()
  const receipt = await tx.commercialOperation.create({
    data: {
      tenantId,
      operatorId,
      operation: input.kind,
      amountMinor: input.amountMinor === undefined ? null : BigInt(input.amountMinor),
      currency: input.currency,
      reason: input.reason,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      before,
      after,
      result,
      correlationId: requestContext.correlationId(),
    },
  })
  await tx.auditLog.create({
    data: {
      tenantId,
      actorType: 'PLATFORM_OPERATOR',
      actorId: operatorId,
      action: `commercial.${input.kind}`,
      targetType: 'commercial_operation',
      targetId: receipt.id,
      changes: redactAudit({
        operationId: receipt.id,
        reason: input.reason,
        reference: input.reference,
        before,
        after,
      }) as Prisma.InputJsonValue,
      correlationId: requestContext.correlationId(),
    },
  })
  await tx.platformAudit.createMany({
    data: {
      operatorId,
      workspaceId: tenantId,
      action: `commercial.${input.kind}`,
      outcome: 'SUCCESS',
      correlationId: requestContext.correlationId(),
    },
  })
  await tx.outboxEvent.create({
    data: {
      tenantId,
      eventType: 'commercial.operation_completed',
      aggregateType: 'commercial_operation',
      aggregateId: receipt.id,
      payload: { operationId: receipt.id },
      correlationId: requestContext.correlationId(),
    },
  })
  return receipt
}
