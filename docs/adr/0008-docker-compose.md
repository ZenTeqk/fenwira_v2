# ADR-0008: Docker Compose as the v2 deployment target

**Status:** Accepted

## Context

The immediate goal is a reliable, reproducible platform for development, demos and early customers. Cloud infrastructure-as-code would slow the build down without an immediate need.

## Decision

Docker Compose is the only deployment target in v2: 7 services plus one-shot `migrate` and `minio-init`. There is no AWS, Terraform or Kubernetes code. Portability is preserved through S3-compatible storage, SMTP mail, env-only configuration, and stateless api and worker processes.

## Consequences

- `git clone && cp .env.example .env && docker compose up -d` is the whole setup.
- Moving to production later is a hosting change, not a code change (`DEPLOYMENT.md` → path to production).
- No autoscaling or managed backups until then. Backups are scripted and restore-tested (Phase 12).

## Alternatives rejected

- **Kubernetes now:** operational weight with no current benefit.
- **Native host services:** not reproducible across machines.
