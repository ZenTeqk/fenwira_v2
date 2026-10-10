# ADR-0019: Dependency version policy

**Status:** Accepted (Phase 1)

## Context

When Phase 1 started (2026-09-23), several core dependencies had very recent major releases: TypeScript 7 (the native Go compiler), Prisma 7/8 (a driver-adapter rewrite), NestJS 12, Vitest 5, ioredis 6 and BullMQ 6. Adopting unproven majors in the foundation risks subtle breakage. Examples: decorator-metadata support in the new compiler, and Prisma's new client generation and connection model underneath the RLS layer (ADR-0016).

## Decision

- Pin **exact** versions (no `^`) for every dependency, with the lockfile committed.
- The foundation uses the newest release of the newest *well-established* major:

  | Package | Version |
  | --- | --- |
  | TypeScript | 5.9 |
  | NestJS | 11 |
  | Prisma | 6.19 |
  | Vitest | 3 |
  | BullMQ | 5 |
  | ioredis | 5 |
  | ESLint | 9 |
  | pino | 9 |

- Next.js 16, React 19 and zod 4 are current majors and are adopted as-is.
- Node 22 LTS in images and CI (`.nvmrc`). Local machines on Node 24+ also work.
- Dependabot opens grouped weekly PRs. **Major upgrades are deliberate:** one major per PR, the full CI suite (including integration and the compose smoke test) must pass, and an ADR note is required when behavior changes (for example Prisma 7's driver adapters and `withTenant()`).

## Consequences

- A stable, reproducible foundation, with a known upgrade backlog: TypeScript 7, Prisma 7+, NestJS 12, Vitest 5.
- The RLS integration suite is the safety net for any ORM or driver upgrade.

## Alternatives rejected

- **Latest everything:** too many simultaneous unknowns in the layer every later phase depends on.
- **Caret ranges:** non-reproducible installs.
