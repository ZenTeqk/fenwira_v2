#!/usr/bin/env bash
# Poll the local readiness endpoints until healthy or timeout. For systemd ExecStartPost, deploy
# scripts and operators. Prints status codes only.
#   deploy/scripts/check-health.sh [api|worker|web|all] [timeout-seconds]
# Overrides: FENWIRA_API_URL, FENWIRA_WORKER_URL, FENWIRA_WEB_URL.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

target="${1:-all}"
timeout="${2:-60}"
require_cmd curl

url_for() {
  case "$1" in
    api) echo "${FENWIRA_API_URL:-http://127.0.0.1:4000}/health/ready" ;;
    worker) echo "${FENWIRA_WORKER_URL:-http://127.0.0.1:4100}/health/ready" ;;
    web) echo "${FENWIRA_WEB_URL:-http://127.0.0.1:3000}/api/health" ;;
  esac
}
case "$target" in
  all) names=(api worker web) ;;
  api | worker | web) names=("$target") ;;
  *) die "usage: $0 [api|worker|web|all] [timeout-seconds]" 2 ;;
esac

failed=0
for name in "${names[@]}"; do
  url="$(url_for "$name")"
  deadline=$((SECONDS + timeout))
  code=000
  while ((SECONDS < deadline)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)"
    [[ "$code" == "200" ]] && break
    sleep 2
  done
  if [[ "$code" == "200" ]]; then
    log "$name ready"
  else
    warn "$name not ready (HTTP $code from $url); see: journalctl -u fenwira-$name -n 100"
    failed=1
  fi
done
exit "$failed"
