import {
  type DomainEventPayload,
  type DomainEventType,
  type EventEnvelope,
} from '@fenwira/contracts'
import { type JobsOptions } from 'bullmq'
import { type QueueName } from './names'

/** Every job carries correlation and (except system.*) tenant context — docs/ARCHITECTURE.md. */
export type JobContext = {
  correlationId: string
  tenantId: string | null
}

/** Jobs produced by the outbox relay: the event envelope plus its typed payload. */
export type EventJob<T extends DomainEventType = DomainEventType> = EventEnvelope & {
  eventType: T
  payload: DomainEventPayload<T>
}

const JOB_ID_SEPARATOR = '__'

/**
 * Deterministic BullMQ job id from parts. BullMQ rejects ':' in custom ids (it is the Redis
 * key separator), so parts are joined with '__' and must not contain ':' themselves.
 */
export function jobId(...parts: Array<string | number>): string {
  const rendered = parts.map(String)
  for (const part of rendered) {
    if (part.length === 0) throw new Error('jobId parts must be non-empty')
    if (part.includes(':')) throw new Error(`jobId part must not contain ':' (got "${part}")`)
  }
  return rendered.join(JOB_ID_SEPARATOR)
}

/** Job id for the relay fan-out of one outbox event to one subscriber queue. */
export function eventJobId(eventId: string, subscriber: QueueName): string {
  return jobId(eventId, subscriber)
}

/**
 * Retry policy per queue (docs/MESSAGING_ENGINE.md → Retry policy). Outbound uses the processor's
 * custom backoff (exponential with jitter; long delays for Meta rate limits).
 */
export const QUEUE_JOB_OPTIONS: Partial<Record<QueueName, JobsOptions>> = {
  'whatsapp.outbound': { attempts: 5, backoff: { type: 'custom' } },
  'whatsapp.inbound': { attempts: 8, backoff: { type: 'exponential', delay: 1000 } },
  'whatsapp.status': { attempts: 8, backoff: { type: 'exponential', delay: 1000 } },
  'whatsapp.media': { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
  // AI Assistant ingestion: infrastructure errors (Bedrock throttling, S3) get 3 attempts.
  'ai.ingest': { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
}

/** Job id for an outbox event on a queue. An outbound send is keyed by its message id. */
export function outboxJobId(
  event: { id: string; eventType: string; payload: unknown },
  queue: QueueName,
): string {
  const messageId = (event.payload as { messageId?: unknown } | null)?.messageId
  if (event.eventType === 'message.outbound.requested' && typeof messageId === 'string')
    return jobId('send', messageId)
  return eventJobId(event.id, queue)
}
