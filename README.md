# Fenwira v2

A multi-tenant WhatsApp Business platform with a shared inbox, contacts and consent, templates, campaigns, automation, billing and analytics. It is built from scratch in phases. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run it

Requirements: Docker with Compose v2. For development outside containers you also need Node 22+ and pnpm 10.

```bash
cp .env.example .env            # or: pnpm setup:env   (random secrets)
docker compose up -d --wait     # first run builds the images
```

| URL | What |
| --- | --- |
| http://localhost:3000 | Web app (Phase 1: status page) |
| http://localhost:4000/health/ready | API readiness (Postgres, Redis, queue) |
| http://localhost:8025 | Mailpit (captured email) |
| http://localhost:9001 | MinIO console |

Postgres and Redis are intentionally not published to the host.

## Develop

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # static checks + unit tests
pnpm test:integration                      # Postgres/Redis integration suite (in Docker)
pnpm dev                                   # hot-reload stack (docker-compose.dev.yml)
pnpm smoke                                 # end-to-end check against a running stack
```

Read [AGENTS.md](AGENTS.md) before contributing. It holds the architecture rules, the design system and the definition of done. The specs are in [docs/](docs/), the decisions in [docs/adr/](docs/adr/), and each phase's task prompt in [docs/prompts/](docs/prompts/).

### Migrations

`packages/database` owns the schema. A schema change ships as a Prisma migration (`prisma/migrations/`) plus any RLS/system-function SQL in `packages/database/sql/post-migrate.sql`. `pnpm test:integration` runs `db:deploy` (migrations, then `post-migrate.sql`, then the RBAC seed and an RLS check) against a real Postgres before the suite runs — that's the one place migrations are exercised end to end, so a schema change isn't done until that passes. Every new tenant-owned table needs an RLS cross-tenant test (see `packages/database/test/tenant-matrix.int.test.ts`).

### Production build

`pnpm build` (Turborepo) builds every app and package — `apps/web`, `apps/api`, `apps/worker` and their shared `packages/*` dependencies. Passing `pnpm test` is not proof the monorepo builds; CI builds it separately (see below) and the `docker` job also builds and boots the real container images (`infrastructure/docker/*.Dockerfile`).

## Repository and branching

The remote is `ZenTeqk/fenwira_v2` (private). `main` is intentionally kept at the pre-phase product/architecture specification commit — phase work happens on its own branch (`phase-N-name`, or `phase-N` once a phase spans a plan + implementation pair like `phase-11-plan` → `phase-11`) and is **not** merged into `main` as a matter of routine; `main` moves only by deliberate decision, not automatically when a phase branch is pushed.

Workflow for ordinary feature/phase work:

```text
phase branch (e.g. phase-11)
  → commit
  → push
  → pull request (into main, or into the phase's own tracking branch as the team decides)
  → CI (see below)
  → review
  → merge
```

Do not commit directly to `main`. Continue Phase 11 work on `phase-11` (or a branch derived from it) rather than opening a new phase-11 branch from scratch.

## CI

`.github/workflows/ci.yml` runs on every pull request and on push to `main`, with per-ref concurrency (a new push cancels a superseded run of the same branch/PR). It uses the Node and pnpm versions pinned in `.nvmrc` / `package.json#packageManager`, with pnpm's dependency cache enabled.

| Job | Checks |
| --- | --- |
| `verify` | `pnpm install --frozen-lockfile`, lint (ESLint + `lint:deps` module boundaries + `lint:design` token check), typecheck, unit tests, `pnpm build`, OpenAPI doc is current (`openapi.mjs --check`), `prettier --check` |
| `integration` | The real integration suite (`pnpm test:integration`) against Postgres and Redis in the `fenwira-test` Compose service, as the `fenwira_app` role — migrations and `post-migrate.sql` run first, exactly as in local development |
| `docker` | Builds every container image, boots the full stack (`docker compose up -d --wait`), runs `pnpm smoke`, runs the Playwright/axe E2E suite against the composed stack, then scans the built images with Trivy (fixable HIGH/CRITICAL) |
| `security` | `gitleaks` over full git history, `pnpm audit --prod` |

All jobs use `permissions: contents: read` (no job needs more). Nothing in CI touches production infrastructure: WhatsApp/Meta calls go through the in-repo mock (`fenwira-meta-mock`, `COMPOSE_PROFILES=meta-mock`), and every credential in `.env.example` is a local-only placeholder. There is no deployment job — this pipeline is CI, not CD; a future AWS deploy workflow should use GitHub OIDC rather than stored AWS access keys.

### Branch protection (recommended for `main`)

- Require a pull request before merging (no direct pushes)
- Require the `verify`, `integration` and `docker` status checks to pass
- Require the branch to be up to date with `main` before merging
- Block force pushes to `main`
- Block deletion of `main`
- Leave repository administrators able to override in a genuine emergency — this is a safety net, not a lockout
