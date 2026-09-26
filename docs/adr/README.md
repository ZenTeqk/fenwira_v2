# Architecture Decision Records

Format: Context → Decision → Consequences → Alternatives rejected. Status is **Accepted** unless noted. To change a decision, write a new ADR that supersedes the old one. Don't edit accepted ADRs, except to add a "Superseded by" link.

| ADR | Title |
| --- | --- |
| [0001](0001-modular-monolith.md) | Modular monolith |
| [0002](0002-nextjs-frontend.md) | Next.js for the frontend |
| [0003](0003-nestjs-backend.md) | NestJS for the backend |
| [0004](0004-postgresql.md) | PostgreSQL 16 as the system of record |
| [0005](0005-row-level-security.md) | Row Level Security for tenant isolation |
| [0006](0006-redis.md) | Redis for queues, locks, presence and rate limits |
| [0007](0007-bullmq.md) | BullMQ for background jobs |
| [0008](0008-docker-compose.md) | Docker Compose as the v2 deployment target |
| [0009](0009-react-flow.md) | React Flow for the automation builder |
| [0010](0010-websockets-socketio.md) | WebSockets via Socket.IO for realtime |
| [0011](0011-tenant-architecture.md) | Shared-schema tenant architecture |
| [0012](0012-event-architecture.md) | Domain events for cross-module async work |
| [0013](0013-outbox-pattern.md) | Transactional outbox |
| [0014](0014-idempotency-strategy.md) | Idempotency strategy |
| [0015](0015-pnpm-turborepo.md) | pnpm workspaces + Turborepo monorepo |
| [0016](0016-prisma-with-rls.md) | Prisma ORM coexisting with RLS |
| [0017](0017-uuidv7-ids.md) | UUIDv7 primary keys |
| [0018](0018-compiled-internal-packages.md) | Internal packages ship compiled CommonJS |
| [0019](0019-dependency-version-policy.md) | Dependency version policy |
| [0020](0020-worker-runtime.md) | In-house worker runtime instead of @nestjs/bullmq |
| [0021](0021-ui-package-as-source.md) | @fenwira/ui is consumed as TypeScript source |
| [0022](0022-specification-freeze.md) | Specification freeze decisions with architectural impact |
| [0023](0023-open-question-resolutions.md) | Tenant purge, message eligibility, sequential automation runs and wallet reservations |
| [0024](0024-billing-modes-pricing-template-pause.md) | Tenant billing modes, price book structure, and template-unavailable pause |
