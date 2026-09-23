# ADR-0002: Next.js for the frontend

**Status:** Accepted

## Context

We need a TypeScript React frontend with routing, layouts, a production build, and room for later public pages (such as the invitation preview).

## Decision

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. Authenticated app pages are client components that fetch from the NestJS API with TanStack Query. Server components are used for shells and metadata only. Next.js route handlers are not used as a backend, apart from `/api/health`.

## Consequences

- One mainstream framework with file-based layouts that fit the app shell.
- There are no business logic or secrets in the web tier. All authorization lives in the API.
- The client-side auth gate means a brief loading state on first load. That is acceptable for an authenticated app.

## Alternatives rejected

- **Vite SPA:** simpler, but gives up layouts, image/font optimization and an easy path to server-rendered public pages.
- **Next.js as a BFF with server actions:** splits the backend into two places and weakens the single-authorization-point rule.
