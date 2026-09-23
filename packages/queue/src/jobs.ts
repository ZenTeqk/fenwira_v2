import {
  type DomainEventPayload,
  type DomainEventType,
  type EventEnvelope,
} from '@fenwira/contracts'
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
