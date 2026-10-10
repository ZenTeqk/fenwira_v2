#!/usr/bin/env bash
# Apply pending database migrations, explicitly, before switching a release live.
#   deploy/scripts/migrate.sh <release-dir> <migrate.env>
#
# Runs packages/database/dist/cli/migrate.js (the same command as the Compose fenwira-migrate
# service): `prisma migrate deploy` (applies only pending, committed migrations; never `db push`,
# never resets), then the idempotent post-migrate.sql (RLS policies, grants, SECURITY DEFINER
# functions), the RLS coverage check and the RBAC/plan seeds. Safe to rerun: nothing pending is a no-op.
# Services never run migrations themselves.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

release_dir="${1:-}"
env_file="${2:-}"
[[ -n "$release_dir" && -n "$env_file" ]] || die "usage: $0 <release-dir> <migrate.env>" 2

require_node
check_env_file_permissions "$env_file"
require_file "$release_dir/packages/database/dist/cli/migrate.js"
require_file "$release_dir/packages/database/sql/post-migrate.sql"
[[ -d "$release_dir/packages/database/prisma/migrations" ]] || die "migration history missing in $release_dir"

"$REPO_ROOT/deploy/scripts/check-env.sh" migrate "$env_file" "$release_dir"

log "applying migrations from $(cat "$release_dir/RELEASE" 2>/dev/null || echo "$release_dir")"
cd "$release_dir"
env -i PATH="$PATH" HOME="${HOME:-/tmp}" \
  node --env-file="$env_file" packages/database/dist/cli/migrate.js
log "migrations complete"
