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
