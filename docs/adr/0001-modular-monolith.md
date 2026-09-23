# ADR-0001: Modular monolith

**Status:** Accepted

## Context

Fenwira has about 12 business modules with heavy shared transactional needs. For example, sending a message touches conversations, contacts, consent and billing. The team is small, and the deployment target is Docker Compose.

## Decision

A single NestJS codebase (`apps/api`), deployed as two process types (`api`, `worker`) that share the same domain modules. Module boundaries are enforced in code: each module has a public `index.ts`, writes only its own tables, and reaches other modules only through their exported services (sync) or domain events (async). dependency-cruiser enforces this in CI.

## Consequences

- One deploy, one database transaction across modules when needed, and simple local development.
- Boundaries only stay real if CI enforces them. Violations fail the build.
- A module can later be extracted into a service by swapping its in-process service for a client, because modules already communicate through narrow interfaces and events.

## Alternatives rejected

- **Microservices:** distributed transactions and operational cost far exceed the benefit at this stage.
- **Unstructured monolith:** fast at first, then unmaintainable coupling (for example campaigns calling Meta directly).
