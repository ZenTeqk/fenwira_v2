# ADR-0021: @fenwira/ui is consumed as TypeScript source

**Status:** Accepted (Phase 2). A deliberate exception to ADR-0018 for the React UI package only.

## Context

ADR-0018 compiles workspace packages to CommonJS `dist`. For React components that breaks down:

- `tsc`'s CommonJS output puts `"use strict"` ahead of `"use client"`, which risks Next.js missing the client boundary.
- A compile step between editing a component and seeing it would make design iteration slow.
- Tailwind must scan the component source to generate the classes the components use.

## Decision

- `packages/ui` has `"type": "module"`, and its `exports` point at source: `"."` is `./src/index.ts` and `"./theme.css"` is `./src/styles/theme.css`. There is no build step.
- apps/web compiles it with `transpilePackages: ['@fenwira/ui']`. Vitest runs it directly in jsdom.
- The Tailwind v4 theme lives in the package and declares `@source ".."`, so importing `@fenwira/ui/theme.css` also makes Tailwind scan every component.
- dependency-cruiser's `no-deep-package-imports` allows exactly `packages/ui/src/index.ts`. Reaching into `src/components/*` is still an error.
- Server packages (config, contracts, database, queue, whatsapp, api) keep ADR-0018.

## Consequences

- Editing a component hot-reloads in `next dev`, and `"use client"` directives are preserved per file.
- `@fenwira/ui` can only be consumed by bundlers (Next, Vite, Vitest), never by plain Node. That's fine: it's UI-only.
