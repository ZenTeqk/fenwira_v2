#!/usr/bin/env bash
# Render deploy/nginx templates into an output directory (then copy into /etc/nginx).
#   deploy/scripts/render-nginx.sh --out <dir> \
#     --app-domain app.fenwira.zenteqk.com --api-domain api.fenwira.zenteqk.com \
#     --app-cert <fullchain.pem> --app-key <privkey.pem> \
#     --api-cert <fullchain.pem> --api-key <privkey.pem> \
#     [--static-dir /opt/fenwira/current/apps/web/.next/standalone/apps/web/.next/static]
# Output layout: sites-available/fenwira-{app,api,default}.conf, snippets/*.conf, conf.d/*.conf.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

out="" app_domain="" api_domain="" app_cert="" app_key="" api_cert="" api_key=""
static_dir="/opt/fenwira/current/apps/web/.next/standalone/apps/web/.next/static"
while (($#)); do
  case "$1" in
    --out) out="$2" ;;
    --app-domain) app_domain="$2" ;;
    --api-domain) api_domain="$2" ;;
    --app-cert) app_cert="$2" ;;
    --app-key) app_key="$2" ;;
    --api-cert) api_cert="$2" ;;
    --api-key) api_key="$2" ;;
    --static-dir) static_dir="$2" ;;
    *) die "unknown option $1" 2 ;;
  esac
  shift 2
done
for v in out app_domain api_domain app_cert app_key api_cert api_key; do
  [[ -n "${!v}" ]] || die "--${v//_/-} is required" 2
done
domain_re='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
[[ "$app_domain" =~ $domain_re && "$api_domain" =~ $domain_re ]] || die "invalid domain name"

src="$REPO_ROOT/deploy/nginx"
mkdir -p "$out/sites-available" "$out/snippets" "$out/conf.d"
render() { # template domain cert key output
  sed -e "s|@@APP_DOMAIN@@|$app_domain|g" -e "s|@@API_DOMAIN@@|$api_domain|g" \
    -e "s|@@TLS_CERT@@|$3|g" -e "s|@@TLS_KEY@@|$4|g" -e "s|@@WEB_STATIC_DIR@@|$static_dir|g" \
    "$1" >"$5"
  ! grep -q '@@[A-Z_]*@@' "$5" || die "unrendered placeholder left in $5"
}
render "$src/fenwira-app.conf.template" "$app_domain" "$app_cert" "$app_key" "$out/sites-available/fenwira-app.conf"
render "$src/fenwira-api.conf.template" "$api_domain" "$api_cert" "$api_key" "$out/sites-available/fenwira-api.conf"
cp "$src/fenwira-default.conf" "$out/sites-available/fenwira-default.conf"
cp "$src"/snippets/*.conf "$out/snippets/"
cp "$src"/conf.d/*.conf "$out/conf.d/"
log "rendered nginx configuration into $out"
