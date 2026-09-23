# ADR-0004: PostgreSQL 16 as the system of record

**Status:** Accepted

## Context

We need relational integrity, strong transactions, row-level security, full-text search, JSONB for flexible payloads, and mature tooling.

## Decision

PostgreSQL 16 is the only system of record. Extensions: `citext` and `pg_trgm`. Postgres full-text search serves inbox search.

## Consequences

- Business state (message status, campaign progress, ledger) is always recoverable from Postgres. Redis is disposable (ADR-0006).
- No separate search engine in v2. That may need revisiting at a large scale.

## Alternatives rejected

- **MySQL:** no native RLS.
- **MongoDB:** weak multi-document transactional guarantees for ledger and outbox needs.
