#!/usr/bin/env bash
# Static and tool-based validation of deploy/systemd and deploy/nginx.
#   deploy/scripts/validate-templates.sh [release-dir]
# Always: structure checks, no secrets, ExecStart targets exist in the release (if given).
# When available: `systemd-analyze verify` (Ubuntu) and `nginx -t` on a rendered copy with a
# throwaway self-signed certificate.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

release="${1:-}"
units="$REPO_ROOT/deploy/systemd"
failed=0
fail() {
  warn "$*"
  failed=1
}

for unit in "$units"/fenwira-{api,worker,web}.service; do
  name="$(basename "$unit")"
  grep -q '^User=fenwira$' "$unit" || fail "$name: must run as the non-root fenwira user"
  grep -q '^EnvironmentFile=/etc/fenwira/' "$unit" || fail "$name: EnvironmentFile missing"
  grep -q '^NoNewPrivileges=true$' "$unit" || fail "$name: hardening missing"
  grep -q '^KillSignal=SIGTERM$' "$unit" || fail "$name: graceful shutdown signal missing"
  if grep -Eiq '^(Environment=.*(PASSWORD|SECRET|TOKEN|KEY)=)' "$unit"; then fail "$name: inline secret"; fi
  if grep -v '^[[:space:]]*#' "$unit" | grep -Eiq '\b(docker|podman|containerd|pm2)\b'; then
    fail "$name: container/PM2 dependency"
  fi
  if [[ -n "$release" ]]; then
    wd="$(sed -n 's|^WorkingDirectory=/opt/fenwira/current||p' "$unit")"
    script="$(sed -n 's|^ExecStart=/usr/bin/node \(--enable-source-maps \)\{0,1\}||p' "$unit")"
    [[ -f "$release$wd/$script" ]] || fail "$name: ExecStart target $wd/$script not in release"
  fi
done
log "systemd templates: static checks done"

if command -v systemd-analyze >/dev/null 2>&1; then
  # verify needs the referenced user and binaries; report but don't hard-fail off-server.
  systemd-analyze verify "$units"/fenwira-*.service "$units/fenwira.target" ||
    warn "systemd-analyze reported issues (expected before the server is provisioned)"
else
  log "systemd-analyze not available; skipped"
fi

for f in "$REPO_ROOT"/deploy/nginx/*.template; do
  if grep -Eq 'ssl_certificate(_key)? +/' "$f"; then fail "$(basename "$f"): hardcoded certificate path"; fi
  if grep -Eq 'listen +[0-9.]*:?(3000|4000|4100|6379)' "$f"; then fail "$(basename "$f"): exposes an internal port"; fi
done

default_site="$REPO_ROOT/deploy/nginx/fenwira-default.conf"
grep -q 'ssl_reject_handshake on;' "$default_site" || fail "fenwira-default.conf: unknown TLS host names must be refused"
grep -q 'return 421;' "$default_site" || fail "fenwira-default.conf: foreign Host headers must get 421"
grep -q 'location ^~ /health' "$REPO_ROOT/deploy/nginx/fenwira-api.conf.template" ||
  fail "fenwira-api.conf.template: readiness endpoints must not be public"

if command -v nginx >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=fenwira.test' \
    -keyout "$tmp/key.pem" -out "$tmp/cert.pem" >/dev/null 2>&1
  mkdir -p "$tmp/static" "$tmp/logs"
  "$REPO_ROOT/deploy/scripts/render-nginx.sh" --out "$tmp/etc" \
    --app-domain app.fenwira.test --api-domain api.fenwira.test \
    --app-cert "$tmp/cert.pem" --app-key "$tmp/key.pem" \
    --api-cert "$tmp/cert.pem" --api-key "$tmp/key.pem" --static-dir "$tmp/static" \
    --legacy-app-domain app.legacy.test --legacy-api-domain api.legacy.test \
    --legacy-cert "$tmp/cert.pem" --legacy-key "$tmp/key.pem" >/dev/null
  # The company-site block, with its placeholder guard bypassed (the pages aren't published here).
  sed -e "s|@@SITE_DOMAIN@@|fenwira.test|g" -e "s|@@SITE_ROOT@@|$tmp/static|g" \
    -e "s|@@TLS_CERT@@|$tmp/cert.pem|g" -e "s|@@TLS_KEY@@|$tmp/key.pem|g" \
    "$REPO_ROOT/deploy/nginx/fenwira-site.conf.template" >"$tmp/etc/sites-available/fenwira-site.conf"
  sed -i.bak "s|/etc/nginx/snippets/|$tmp/etc/snippets/|g" "$tmp"/etc/sites-available/*.conf
  cat >"$tmp/nginx.conf" <<EOF
pid $tmp/nginx.pid;
error_log $tmp/logs/error.log;
events {}
http {
  access_log off;
  client_body_temp_path $tmp; proxy_temp_path $tmp; fastcgi_temp_path $tmp;
  uwsgi_temp_path $tmp; scgi_temp_path $tmp;
  include $tmp/etc/conf.d/*.conf;
  include $tmp/etc/sites-available/*.conf;
}
EOF
  if nginx -t -c "$tmp/nginx.conf" -p "$tmp" 2>"$tmp/nginx-test.log"; then
    log "nginx -t: configuration valid"
  else
    cat "$tmp/nginx-test.log" >&2
    fail "nginx -t failed"
  fi
else
  log "nginx/openssl not available; nginx -t skipped"
fi

((failed == 0)) || die "template validation failed"
log "templates valid"
