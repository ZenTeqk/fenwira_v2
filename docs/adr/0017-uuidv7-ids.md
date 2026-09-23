# ADR-0017: UUIDv7 primary keys

**Status:** Accepted

## Context

IDs appear in URLs, logs, events and cursors. We want no enumeration, global uniqueness across tables, and index-friendly insert order.

## Decision

All primary keys are UUIDv7, generated in the app (Prisma `@default(uuid(7))`). Correlation IDs are also UUIDv7. Cursors are built on `(sortValue, id)`.

## Consequences

- Time-ordered inserts keep B-tree indexes efficient (unlike v4).
- IDs leak creation time. That is acceptable, because no ID encodes sensitive data.
- IDs aren't sequential integers, so there is no tenant-size enumeration.

## Alternatives rejected

- **UUIDv4:** random index writes.
- **bigserial:** enumerable, and collides across tenants in exports and merges.
- **ULID:** equivalent benefits, but non-native to Postgres uuid tooling.
