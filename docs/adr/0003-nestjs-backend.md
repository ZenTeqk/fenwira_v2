# ADR-0003: NestJS for the backend

**Status:** Accepted

## Context

The backend needs structured modules, dependency injection, guards (auth, tenant, permission, entitlement), WebSockets, and queue workers sharing the same code, all in TypeScript to share contracts with the frontend.

## Decision

NestJS for both `apps/api` (HTTP + WS) and `apps/worker` (standalone application context with BullMQ processors). Validation uses Zod schemas from `packages/contracts` through a custom pipe, not class-validator.

## Consequences

- Guards and interceptors map directly onto our request lifecycle (`ARCHITECTURE.md`).
- The same modules are loaded by both processes, so there is no duplicated logic.
- Zod rather than class-validator keeps one schema language across web and api.

## Alternatives rejected

- **Fastify/Express bare:** we would rebuild DI, modules and guards ourselves.
- **tRPC:** couples clients to the server's types, whereas we need a public REST API (Phase 11).
