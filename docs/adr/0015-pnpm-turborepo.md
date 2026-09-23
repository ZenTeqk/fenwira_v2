# ADR-0015: pnpm workspaces + Turborepo monorepo

**Status:** Accepted. The package-consumption clause was superseded by [ADR-0018](0018-compiled-internal-packages.md).

## Context

Three apps and six shared packages must share types, schemas and config, with fast CI.

## Decision

pnpm workspaces (strict, non-hoisted `node_modules`) with Turborepo for task orchestration and caching (`lint`, `typecheck`, `test`, `build`). Node 22 LTS, pinned through `packageManager` and `.nvmrc`. Internal packages are consumed as TypeScript source (`"exports"` pointing at `src`) with project references for typechecking.

## Consequences

- One install, cached CI tasks, and enforced dependency boundaries (pnpm strictness surfaces undeclared deps).
- Docker builds use `turbo prune --docker` for minimal build contexts.

## Alternatives rejected

- **npm/yarn workspaces:** weaker strictness and slower installs.
- **Nx:** more powerful but heavier than we need.
