#!/usr/bin/env bash
# Verify a release directory contains every runtime file the systemd units and migrate.sh use,
# includes the Linux Prisma engine, and carries no secrets or Docker runtime dependency.
#   deploy/scripts/verify-build.sh <release-dir>
set -euo pipefail
source "$(dirname "$0")/lib.sh"

release="${1:-}"
[[ -n "$release" && -d "$release" ]] || die "usage: $0 <release-dir>" 2
cd "$release"

missing=0
check() {
  if [[ -e "$1" ]]; then log "ok  $1"; else
    warn "missing $1"
    missing=1
  fi
}

# Entry points referenced by deploy/systemd/*.service and deploy/scripts/migrate.sh.
check apps/api/dist/main.js
check apps/worker/dist/main.js
check apps/web/.next/standalone/apps/web/server.js
check apps/web/.next/standalone/apps/web/.next/static
check apps/web/.next/standalone/apps/web/public
check apps/web/.next/standalone/apps/web/.next/cache
check packages/database/dist/cli/migrate.js
check packages/database/sql/post-migrate.sql
check packages/database/prisma/migrations/migration_lock.toml
for pkg in config contracts queue database whatsapp; do check "packages/$pkg/dist/index.js"; done

engine="$(find node_modules/.pnpm -path '*/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node' -print -quit 2>/dev/null || true)"
if [[ -n "$engine" ]]; then log "ok  Prisma engine debian-openssl-3.0.x"; else
  warn "Prisma query engine for debian-openssl-3.0.x (Ubuntu 24.04) not found"
  missing=1
fi

# Deployment tooling run from the release (migrate.sh, operators, the CD workflow).
for f in check-env.mjs check-env.sh migrate.sh check-health.sh render-nginx.sh lib.sh deploy-release.sh; do
  check "deploy/scripts/$f"
done
if [[ -x deploy/scripts/render-env-from-ssm.py ]]; then log "ok  deploy/scripts/render-env-from-ssm.py"; else
  warn "missing or not executable: deploy/scripts/render-env-from-ssm.py"
  missing=1
fi
check deploy/nginx/fenwira-default.conf
# Prisma reads only the first certificate of sslcert, so the validator must enforce a single-root
# CA file (PRODUCTION_RUNTIME.md → Database TLS). A release without that check must not ship.
if grep -q 'Prisma reads only the first' deploy/scripts/check-env.mjs 2>/dev/null; then
  log "ok  check-env.mjs enforces a single-certificate sslcert"
else
  warn "deploy/scripts/check-env.mjs lacks the single-certificate sslcert check"
  missing=1
fi
if [[ -n "$(find deploy -name '__pycache__' -print -quit 2>/dev/null)" ]]; then
  warn "__pycache__ directories in release"
  missing=1
fi

# No real env files may ship inside a release (templates end in .example).
secrets="$(find . -path ./node_modules -prune -o \( -name '.env' -o -name '.env.*' -o -name '*.env' \) \
  ! -name '*.example' ! -name '.env.example' ! -name '.env.development' ! -name '.env.test' -print 2>/dev/null || true)"
if [[ -n "$secrets" ]]; then
  warn "environment files found in release: $secrets"
  missing=1
fi

# The production runtime must not invoke a container runtime.
if cat "$REPO_ROOT"/deploy/systemd/fenwira* | grep -v '^[[:space:]]*#' | grep -Eiq '\b(docker|podman|containerd|pm2)\b'; then
  warn "deploy/systemd references a container runtime"
  missing=1
fi

((missing == 0)) || die "release verification failed"
log "release verified ($(cat RELEASE 2>/dev/null || echo unversioned))"
