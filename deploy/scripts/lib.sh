#!/usr/bin/env bash
# Shared helpers for deploy/scripts (sourced, not executed). Never print environment values.
set -euo pipefail

# shellcheck disable=SC2034 # used by the scripts that source this file
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_MAJOR_REQUIRED=22
PNPM_VERSION_REQUIRED=10.34.5

log() { printf '[fenwira] %s\n' "$*"; }
warn() { printf '[fenwira] WARN: %s\n' "$*" >&2; }
die() {
  printf '[fenwira] ERROR: %s\n' "$*" >&2
  exit "${2:-1}"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_node() {
  require_cmd node
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$major" == "$NODE_MAJOR_REQUIRED" ]] ||
    die "Node.js ${NODE_MAJOR_REQUIRED}.x required (.nvmrc), found $(node -v)"
}

require_pnpm() {
  require_cmd pnpm
  local v
  v="$(pnpm -v)"
  [[ "$v" == "$PNPM_VERSION_REQUIRED" ]] ||
    warn "pnpm ${PNPM_VERSION_REQUIRED} expected (packageManager), found ${v}"
}

require_file() {
  [[ -f "$1" ]] || die "missing file: $1"
}

# Readable by the service group only; refuse world-readable secret files.
check_env_file_permissions() {
  local file="$1" mode
  require_file "$file"
  if mode="$(stat -c '%a' "$file" 2>/dev/null)" || mode="$(stat -f '%Lp' "$file" 2>/dev/null)"; then
    [[ "${mode: -1}" == "0" ]] || die "$file is world-accessible (mode $mode); use 0640 or 0600"
  fi
}
