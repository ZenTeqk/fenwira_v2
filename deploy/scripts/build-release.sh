#!/usr/bin/env bash
# Build a self-contained production release directory (no Docker).
#   NEXT_PUBLIC_API_URL=https://api.fenwira.zenteqk.com/api/v1 \
#     deploy/scripts/build-release.sh <git-ref|WORKTREE> <dest-dir>
#
# Mirrors infrastructure/docker/{server,web}.Dockerfile: frozen-lockfile install, turbo build of
# web/api/worker and their packages, Next.js standalone assets, production-only dependencies and
# a regenerated Prisma client. Prisma generates only the build machine's query engine, so
# production releases MUST be built on Ubuntu Linux x86_64 (24.04 or a matching CI runner) with
# Node 22 and pnpm 10.34.5; other platforms are refused.
# <dest-dir> must not exist. WORKTREE builds the current checkout including uncommitted files
# (local validation only); production releases use a committed ref.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

ref="${1:-}"
dest="${2:-}"
[[ -n "$ref" && -n "$dest" ]] || die "usage: NEXT_PUBLIC_API_URL=… $0 <git-ref|WORKTREE> <dest-dir>" 2
: "${NEXT_PUBLIC_API_URL:?NEXT_PUBLIC_API_URL is required: it is compiled into the web bundle}"
[[ ! -e "$dest" ]] || die "$dest already exists; releases are immutable, pick a new directory"

[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] ||
  die "build on Ubuntu Linux x86_64 (Prisma engine and native modules must match production)"
require_node
require_pnpm
require_cmd git
require_cmd tar

mkdir -p "$dest"
dest="$(cd "$dest" && pwd)"
if [[ "$ref" == "WORKTREE" ]]; then
  log "copying working tree (tracked + untracked, respecting .gitignore)"
  (cd "$REPO_ROOT" && git ls-files -co --exclude-standard -z |
    tar --null -T - -cf -) | tar -xf - -C "$dest"
  sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD)-worktree"
else
  # Full SHA: releases live in /opt/fenwira/releases/<git-sha> (deploy workflow, SSM deploy document).
  sha="$(git -C "$REPO_ROOT" rev-parse "$ref^{commit}")" || die "unknown git ref: $ref"
  log "exporting $ref ($sha)"
  git -C "$REPO_ROOT" archive --format=tar "$ref" | tar -xf - -C "$dest"
fi

cd "$dest"
export CI=true NEXT_TELEMETRY_DISABLED=1 PRISMA_HIDE_UPDATE_MESSAGE=1
export NEXT_PUBLIC_NAV_PREVIEW="${NEXT_PUBLIC_NAV_PREVIEW:-false}"

log "installing dependencies (frozen lockfile)"
pnpm install --frozen-lockfile

log "building web, api, worker and their packages"
pnpm turbo run build --filter=@fenwira/web... --filter=@fenwira/api... --filter=@fenwira/worker...

log "assembling the Next.js standalone server"
standalone="apps/web/.next/standalone/apps/web"
cp -R apps/web/.next/static "$standalone/.next/static"
cp -R apps/web/public "$standalone/public"
mkdir -p "$standalone/.next/cache"

log "pruning to production dependencies"
pnpm install --frozen-lockfile --prod --config.confirmModulesPurge=false
pnpm --filter @fenwira/database exec prisma generate

printf '%s\n' "$sha" >RELEASE
log "release $sha built in $dest"
"$REPO_ROOT/deploy/scripts/verify-build.sh" "$dest"
