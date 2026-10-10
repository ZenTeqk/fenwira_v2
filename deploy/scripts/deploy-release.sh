#!/usr/bin/env bash
# Activate an extracted release on this server. Run as root by the SSM deploy document
# (infra/terraform/cicd.tf), which downloads the artifact, verifies its SHA-256 and extracts it to
# /opt/fenwira/releases/<release> first.
#   deploy/scripts/deploy-release.sh <release>
#
# Order: verify the build → render env files from SSM into a staging directory → validate them with
# the release's own check-env → run pending migrations → switch `current` → restart the enabled
# services → health checks. A failure before the switch leaves the running release untouched. A
# failed health check after the switch restores the previous release and its env files. Database
# migrations are never rolled back (they must be backward compatible, PRODUCTION_RUNTIME.md).
# Prints names and statuses only, never values.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

release="${1:-}"
[[ "$release" =~ ^[0-9a-f]{7,40}$ ]] || die "usage: $0 <release-sha>" 2
home="${FENWIRA_HOME:-/opt/fenwira}"
etc="${FENWIRA_ETC:-/etc/fenwira}"
keep="${FENWIRA_KEEP_RELEASES:-5}"
dir="$home/releases/$release"
scripts="$dir/deploy/scripts"
[[ -d "$dir" ]] || die "release directory $dir not found"
export PATH="/snap/bin:$PATH" AWS_REGION="${AWS_REGION:-ap-south-1}"

# Services to restart: the application units that are enabled. A disabled unit (the worker while
# SMTP is unconfigured) is neither validated, started nor enabled.
services=()
for s in api web worker; do
  [[ "$(systemctl is-enabled "fenwira-$s" 2>/dev/null || true)" == "enabled" ]] && services+=("$s")
done
((${#services[@]})) || die "no enabled fenwira services"
log "release $release; enabled services: ${services[*]}"

log "1/7 verifying the release"
"$scripts/verify-build.sh" "$dir" >/dev/null

log "2/7 rendering env files from SSM into a staging directory"
staging="$(mktemp -d "$etc/.staging.XXXXXX")"
backup="$etc/.previous"
cleanup() { rm -rf "$staging"; }
trap cleanup EXIT
rc=0
"$scripts/render-env-from-ssm.py" --release "$release" --out "$staging" || rc=$?
# 3 = a required value is missing for some service (today: the worker's SMTP). It only matters for
# services that run, which check-env validates next.
((rc == 0 || rc == 3)) || die "rendering env files failed (exit $rc)"

log "3/7 validating env files for: ${services[*]} migrate"
for s in "${services[@]}" migrate; do
  "$scripts/check-env.sh" "$s" "$staging/$s.env" "$dir" >/dev/null
done

log "4/7 applying pending migrations"
if ! "$scripts/migrate.sh" "$dir" "$staging/migrate.env"; then
  die "migration failed: release NOT activated, the running release is untouched; database changes are not rolled back automatically"
fi

previous="$(readlink "$home/current" 2>/dev/null || true)"
switch_to() {
  ln -sfn "$1" "$home/current.new"
  mv -T "$home/current.new" "$home/current"
}
install_env() { # from-dir
  for f in "$1"/*.env; do cp -p "$f" "$etc/$(basename "$f")"; done
}
restart_and_check() {
  local s ok=0
  for s in "${services[@]}"; do systemctl restart "fenwira-$s"; done
  for s in "${services[@]}"; do "$scripts_active/check-health.sh" "$s" 90 || ok=1; done
  return $ok
}

log "5/7 switching current: ${previous:-none} -> $dir"
rm -rf "$backup"
install -d -m 0700 "$backup"
for f in "$etc"/*.env; do [[ -e "$f" ]] && cp -p "$f" "$backup/"; done
install_env "$staging"
switch_to "$dir"

log "6/7 restarting: ${services[*]}"
scripts_active="$scripts"
if restart_and_check; then
  log "7/7 healthy: $release is live"
else
  warn "health checks failed for $release"
  [[ -n "$previous" && -d "$previous" ]] || die "no previous release to roll back to"
  warn "rolling back to $previous"
  install_env "$backup"
  switch_to "$previous"
  scripts_active="$previous/deploy/scripts"
  [[ -x "$scripts_active/check-health.sh" ]] || scripts_active="$scripts"
  if restart_and_check; then
    die "deployment of $release FAILED health checks; rolled back to $(basename "$previous"), which is healthy"
  fi
  die "deployment of $release FAILED and the rollback to $(basename "$previous") is ALSO unhealthy: manual action required"
fi

# Keep the newest $keep releases; never remove current or previous. Release names are hex SHAs.
current="$(readlink "$home/current")"
# shellcheck disable=SC2012
mapfile -t old < <(ls -1dt "$home"/releases/*/ 2>/dev/null | sed 's:/$::' | tail -n "+$((keep + 1))")
for r in "${old[@]}"; do
  [[ "$r" == "$current" || "$r" == "$previous" ]] && continue
  rm -rf "$r" && log "pruned $(basename "$r")"
done
log "deployment complete: $release (previous: ${previous:+$(basename "$previous")})"
