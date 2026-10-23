#!/usr/bin/env bash
# Render deploy/nginx templates into an output directory (then copy into /etc/nginx).
#   deploy/scripts/render-nginx.sh --out <dir> \
#     --app-domain app.fenwira.zenteqk.com --api-domain api.fenwira.zenteqk.com \
#     --app-cert <fullchain.pem> --app-key <privkey.pem> \
#     --api-cert <fullchain.pem> --api-key <privkey.pem> \
#     [--static-dir /opt/fenwira/current/apps/web/.next/standalone/apps/web/.next/static] \
#     [--legacy-app-domain app.fenwira.zenteqk.com --legacy-api-domain api.fenwira.zenteqk.com \
#      --legacy-cert <fullchain.pem> --legacy-key <privkey.pem>]
# Output layout: sites-available/fenwira-{app,api,default}.conf (+ fenwira-legacy-{app,api}.conf
# when asked), snippets/*.conf, conf.d/*.conf. The apex fenwira.com is the marketing site on
# CloudFront (fenwira_marketing), not this server. ADR-0027 item B: the legacy web host 301-redirects to the app domain; the legacy API host keeps serving the API so
# webhooks configured on it don't break while Meta apps are updated.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

out="" app_domain="" api_domain="" app_cert="" app_key="" api_cert="" api_key=""
legacy_app_domain="" legacy_api_domain="" legacy_cert="" legacy_key=""
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
    --legacy-app-domain) legacy_app_domain="$2" ;;
    --legacy-api-domain) legacy_api_domain="$2" ;;
    --legacy-cert) legacy_cert="$2" ;;
    --legacy-key) legacy_key="$2" ;;
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

extra() { # template output: the optional legacy placeholders
  sed -e "s|@@APP_DOMAIN@@|$app_domain|g" -e "s|@@API_DOMAIN@@|$legacy_api_domain|g" \
    -e "s|@@LEGACY_APP_DOMAIN@@|$legacy_app_domain|g" \
    -e "s|@@LEGACY_TLS_CERT@@|$legacy_cert|g" -e "s|@@LEGACY_TLS_KEY@@|$legacy_key|g" \
    -e "s|@@TLS_CERT@@|$3|g" -e "s|@@TLS_KEY@@|$4|g" -e "s|@@WEB_STATIC_DIR@@|$static_dir|g" \
    "$1" >"$2"
  ! grep -q '@@[A-Z_]*@@' "$2" || die "unrendered placeholder left in $2"
}
if [[ -n "$legacy_app_domain$legacy_api_domain" ]]; then
  for v in legacy_app_domain legacy_api_domain legacy_cert legacy_key; do
    [[ -n "${!v}" ]] || die "--${v//_/-} is required with the legacy domains" 2
  done
  [[ "$legacy_app_domain" =~ $domain_re && "$legacy_api_domain" =~ $domain_re ]] || die "invalid legacy domain"
  extra "$src/fenwira-legacy-app.conf.template" "$out/sites-available/fenwira-legacy-app.conf" "" ""
  # The API once more under its legacy name and certificate (its upstream is defined once already).
  sed -e '/^upstream fenwira_api {/,/^}/d' "$src/fenwira-api.conf.template" >"$out/legacy-api.tmpl"
  extra "$out/legacy-api.tmpl" "$out/sites-available/fenwira-legacy-api.conf" "$legacy_cert" "$legacy_key"
  rm "$out/legacy-api.tmpl"
fi
cp "$src"/snippets/*.conf "$out/snippets/"
cp "$src"/conf.d/*.conf "$out/conf.d/"
log "rendered nginx configuration into $out"
