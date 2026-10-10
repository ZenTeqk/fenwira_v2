# ADR-0018: Internal packages ship compiled CommonJS

**Status:** Accepted (Phase 1). Supersedes the "consumed as TypeScript source" clause of ADR-0015.

## Context

ADR-0015 planned for internal packages to be consumed as TypeScript source (`exports` pointing at `src`). In Phase 1 that turned out to be incompatible with the runtime. NestJS needs `emitDecoratorMetadata`, which esbuild-based loaders (tsx, Node type stripping) drop. Node cannot execute `.ts` from `node_modules` workspace links in production images. The worker also needs to import the api's core and platform modules.

## Decision

- Every workspace package (and `apps/api`, for the worker) compiles with `tsc` to `dist/` as CommonJS (`module`/`moduleResolution: Node16`, no `"type": "module"`).
- `exports` maps point at `dist/*.js` with `types` conditions. Consumers never import `src/`, which dependency-cruiser's `no-deep-package-imports` rule enforces.
- Turbo runs `build` before `typecheck`, `lint`, `test` and `dev` (`dependsOn: ["^build"]`). The `watch` task (`tsc --watch`) keeps `dist` fresh during development, and `node --watch` restarts on any changed required file, including files in other packages' `dist`.
- `apps/api` exposes `./core`, `./modules/platform` and `./bootstrap` for the worker (ADR-0001: one codebase, two process types).
- Vitest runs TypeScript source directly. Nest tests use `unplugin-swc` so that decorator metadata survives.
- Vitest config files are `.mts`, because Vitest's config entry is ESM-only.

## Consequences

- The same artifacts run in development, tests and production images.
- Changing a package means rebuilding it before its dependents' typecheck. Turbo caching makes this cheap.
- apps/web (Next.js, bundler resolution) consumes the same CommonJS `dist` without `transpilePackages`.

## Alternatives rejected

- **Source consumption with SWC register hooks:** fragile across Nest, Vitest and Next, and still needs a build for production images.
- **ESM throughout:** Nest and Prisma 6 ergonomics are better in CommonJS today. Revisit when the stack moves to Prisma 7+/Nest 12+ (see ADR-0019).
