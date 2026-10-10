#!/usr/bin/env bash
# Validate a service env file with the application's own schemas. Prints names, never values.
#   deploy/scripts/check-env.sh <api|worker|web|migrate> <env-file> [release-dir]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

service="${1:-}"
env_file="${2:-}"
release_dir="${3:-$REPO_ROOT}"
[[ -n "$service" && -n "$env_file" ]] || die "usage: $0 <api|worker|web|migrate> <env-file> [release-dir]" 2

require_node
check_env_file_permissions "$env_file"
[[ "$service" == "web" ]] || require_file "$release_dir/packages/config/dist/index.js"

# --env-file parses the same KEY=value lines systemd's EnvironmentFile= reads (no shell expansion).
env -i PATH="$PATH" node --env-file="$env_file" "$REPO_ROOT/deploy/scripts/check-env.mjs" "$service" "$release_dir"
