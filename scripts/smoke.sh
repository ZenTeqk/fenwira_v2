#!/usr/bin/env bash
# End-to-end smoke test against a running stack (docs/prompts/PHASE_01_FOUNDATION.md acceptance).
# Usage: docker compose up -d --wait && pnpm smoke
set -euo pipefail

API="${API_URL:-http://localhost:${API_PORT:-4000}}"
WEB="${WEB_URL:-http://localhost:${WEB_PORT:-3000}}"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ready=$(curl -fsS "$API/health/ready") || fail "api /health/ready not 200"
for check in postgres redis queue; do
  echo "$ready" | grep -q "\"$check\":{\"status\":\"up\"" || fail "api readiness: $check not up ($ready)"
done
pass "api ready (postgres, redis, queue up)"

curl -fsS "$WEB/api/health" >/dev/null || fail "web /api/health not 200"
curl -fsS "$WEB/" | grep -q "Operational" || fail "web status page does not show Operational"
pass "web healthy and rendering API status"

corr="smoke-$(date +%s)"
accepted=$(curl -fsS -X POST -H "X-Correlation-Id: $corr" "$API/api/v1/system/ping") \
  || fail "POST /api/v1/system/ping failed (is SYSTEM_PING_ENABLED=true?)"
event_id=$(echo "$accepted" | sed -E 's/.*"eventId":"([^"]+)".*/\1/')
for _ in $(seq 1 50); do
  status=$(curl -fsS "$API/api/v1/system/ping/$event_id")
  if echo "$status" | grep -q '"PROCESSED"'; then
    echo "$status" | grep -q "\"correlationId\":\"$corr\"" || fail "correlation id not carried: $status"
    pass "outbox round trip: api → outbox → relay → queue → worker ($event_id)"
    exit 0
  fi
  sleep 0.2
done
fail "ping $event_id not processed within 10s"
