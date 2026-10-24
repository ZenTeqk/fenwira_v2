#!/usr/bin/env python3
"""Render /etc/fenwira/{api,worker,web,migrate}.env from SSM Parameter Store.

Run as root on the app server (instance role):
    sudo deploy/scripts/render-env-from-ssm.py --release <release-name> [--out /etc/fenwira]

Sources: /fenwira/prod/config/* (String, Terraform) and /fenwira/prod/secrets/* (SecureString,
manual). Fixed production values mirror deploy/env/*.env.example. Values are never printed: output
lists file names, variable names and any missing required inputs. A required secret that is absent
is reported, never replaced by a placeholder; validation happens with check-env.sh afterwards.
"""
import argparse
import grp
import json
import os
import subprocess
import sys
import tempfile

PREFIX = "/fenwira/prod"

# SSM name (relative to PREFIX) -> environment variable
SECRETS = {
    "secrets/database-url-app": "DATABASE_URL",
    "secrets/database-url-migrate": "MIGRATION_DATABASE_URL",
    "secrets/encryption-keys": "ENCRYPTION_KEYS",
    "secrets/encryption-active-key-id": "ENCRYPTION_ACTIVE_KEY_ID",
    "secrets/jwt-private-key": "JWT_PRIVATE_KEY",
    "secrets/jwt-public-key": "JWT_PUBLIC_KEY",
    "secrets/api-key-pepper": "API_KEY_PEPPER",
    "secrets/meta-webhook-verify-token": "META_WEBHOOK_VERIFY_TOKEN",
    "secrets/meta-app-id": "META_APP_ID",
    "secrets/meta-app-secret": "META_APP_SECRET",
    "secrets/meta-es-config-id": "META_ES_CONFIG_ID",
    "secrets/smtp-url": "SMTP_URL",
    "secrets/mail-from": "MAIL_FROM",
    "secrets/ops-alert-email": "OPS_ALERT_EMAIL",
    "secrets/native-google-client-id": "NATIVE_GOOGLE_CLIENT_ID",
    "secrets/native-google-client-secret": "NATIVE_GOOGLE_CLIENT_SECRET",
    "secrets/native-zoho-client-id": "NATIVE_ZOHO_CLIENT_ID",
    "secrets/native-zoho-client-secret": "NATIVE_ZOHO_CLIENT_SECRET",
    "secrets/native-shopify-client-id": "NATIVE_SHOPIFY_CLIENT_ID",
    "secrets/native-shopify-client-secret": "NATIVE_SHOPIFY_CLIENT_SECRET",
}
CONFIG = {
    "config/aws-region": "S3_REGION",
    "config/s3-endpoint": "S3_ENDPOINT",
    "config/s3-bucket-media": "S3_BUCKET_MEDIA",
    "config/s3-bucket-imports": "S3_BUCKET_IMPORTS",
    "config/s3-bucket-exports": "S3_BUCKET_EXPORTS",
    # ADR-0027 manual UPI billing (docs/MANAGED_LAUNCH.md → Configuration). Non-secret Strings.
    "config/upi-vpa": "UPI_VPA",
    "config/upi-payee-name": "UPI_PAYEE_NAME",
    "config/billing-gstin": "BILLING_GSTIN",
    "config/billing-payment-confirm-hours": "BILLING_PAYMENT_CONFIRM_HOURS",
    # Billing contact shown to customers and in billing emails (P11-D20). Optional.
    "config/billing-support-email": "BILLING_SUPPORT_EMAIL",
}
# Read by both api and worker (invoices, renewals, Managed Launch gating).
BILLING_VARS = ["UPI_VPA", "UPI_PAYEE_NAME", "BILLING_GSTIN", "BILLING_PAYMENT_CONFIRM_HOURS",
                "BILLING_SUPPORT_EMAIL"]


# ML-D5 production values (docs/MANAGED_LAUNCH.md → Configuration). SSM overrides them; the env
# always carries an explicit value, so production never falls back to the schema's dev defaults.
BILLING_DAYS = {
    "config/billing-grace-days": ("BILLING_GRACE_DAYS", 7, 90),
    "config/billing-invoice-lead-days": ("BILLING_INVOICE_LEAD_DAYS", 3, 60),
}


def billing_days(params: dict) -> dict:
    out = {}
    for name, (env, default, most) in BILLING_DAYS.items():
        raw = params.get(name, str(default)).strip()
        if not raw.isdigit() or not 0 <= int(raw) <= most:
            sys.exit(f"[fenwira] ERROR: {name} must be a whole number of days (0-{most})")
        out[env] = str(int(raw))
    return out


def gst_rate(params: dict) -> dict:
    """config/billing-gst-rate is a percentage (e.g. "18"); the app reads basis points.
    GST applies only when both this and config/billing-gstin are set (docs/BILLING.md)."""
    raw = params.get("config/billing-gst-rate", "").strip()
    if not raw:
        return {}
    try:
        bps = round(float(raw) * 100)
    except ValueError:
        sys.exit("[fenwira] ERROR: config/billing-gst-rate must be a percentage such as 18")
    if not 1 <= bps <= 10_000:
        sys.exit("[fenwira] ERROR: config/billing-gst-rate must be between 0.01 and 100")
    return {"BILLING_GST_RATE_BPS": str(bps)}

SHARED_SERVER = {
    "NODE_ENV": "production",
    "LOG_LEVEL": "info",
    "DB_POOL_SIZE": "10",
    "REDIS_URL": "redis://127.0.0.1:6379/0",
    "S3_FORCE_PATH_STYLE": "false",
    "META_GRAPH_BASE_URL": "https://graph.facebook.com",
    "META_GRAPH_API_VERSION": "v23.0",
    "BILLING_ENFORCED": "false",
    "BILLING_SUBSCRIPTIONS_ENFORCED": "false",
}


def managed_launch_mode(params: dict) -> str:
    """ADR-0027: an explicit rollout decision, set in SSM config/managed-launch-mode. Absent = false."""
    value = params.get("config/managed-launch-mode", "false").strip().lower()
    if value not in ("true", "false"):
        sys.exit("[fenwira] ERROR: config/managed-launch-mode must be 'true' or 'false'")
    return value
SERVER_VARS = [
    "DATABASE_URL", "ENCRYPTION_KEYS", "ENCRYPTION_ACTIVE_KEY_ID", "S3_REGION", "S3_ENDPOINT",
    "S3_BUCKET_MEDIA", "S3_BUCKET_IMPORTS", "S3_BUCKET_EXPORTS", "META_APP_ID", "META_APP_SECRET",
    "NATIVE_GOOGLE_CLIENT_ID", "NATIVE_GOOGLE_CLIENT_SECRET", "NATIVE_ZOHO_CLIENT_ID",
    "NATIVE_ZOHO_CLIENT_SECRET", "NATIVE_SHOPIFY_CLIENT_ID", "NATIVE_SHOPIFY_CLIENT_SECRET",
]
REQUIRED = {
    "api": ["DATABASE_URL", "ENCRYPTION_KEYS", "ENCRYPTION_ACTIVE_KEY_ID", "JWT_PRIVATE_KEY",
            "JWT_PUBLIC_KEY", "API_KEY_PEPPER", "S3_ENDPOINT", "S3_REGION"],
    # ADR-0027 step 4: SMTP is optional; without it the worker records emails as skipped.
    "worker": ["DATABASE_URL", "ENCRYPTION_KEYS", "ENCRYPTION_ACTIVE_KEY_ID", "S3_ENDPOINT",
               "S3_REGION"],
    "web": [],
    "migrate": ["MIGRATION_DATABASE_URL"],
}


def fetch(path: str) -> dict:
    out = subprocess.run(
        ["aws", "ssm", "get-parameters-by-path", "--path", path, "--recursive",
         "--with-decryption", "--output", "json"],
        check=True, capture_output=True, text=True,
    ).stdout
    return {p["Name"][len(PREFIX) + 1:]: p["Value"] for p in json.loads(out)["Parameters"]}


def write_env(path: str, values: dict, mode: int, group: str) -> None:
    for k, v in values.items():
        if "\n" in v or "\r" in v:
            sys.exit(f"[fenwira] ERROR: {k} contains a newline; refusing to write {path}")
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".env-")
    try:
        os.fchmod(fd, mode)
        os.fchown(fd, 0, grp.getgrnam(group).gr_gid)
        with os.fdopen(fd, "w") as f:
            f.write("# Rendered from SSM by deploy/scripts/render-env-from-ssm.py; do not edit.\n")
            for k, v in values.items():
                f.write(f"{k}={v}\n")
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp) if os.path.exists(tmp) else None
        raise


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", required=True)
    ap.add_argument("--out", default="/etc/fenwira")
    args = ap.parse_args()
    if os.geteuid() != 0:
        sys.exit("[fenwira] ERROR: run as root")

    params = fetch(f"{PREFIX}/config")
    params.update(fetch(f"{PREFIX}/secrets"))
    src = {env: params[name] for name, env in {**SECRETS, **CONFIG}.items() if name in params}
    app_domain, api_domain = params["config/app-domain"], params["config/api-domain"]
    web_origin = f"https://{app_domain}"
    cookie_domain = "." + app_domain.split(".", 1)[1]

    pick = lambda names: {n: src[n] for n in names if n in src}
    managed = {
        "MANAGED_LAUNCH_MODE": managed_launch_mode(params),
        **gst_rate(params),
        **billing_days(params),
    }
    files = {
        "api": {
            **SHARED_SERVER, **managed, "APP_VERSION": args.release, "HOST": "127.0.0.1",
            "PORT": "4000",
            "METRICS_HOST": "127.0.0.1", "WEB_ORIGIN": web_origin,
            "PUBLIC_API_URL": f"https://{api_domain}", "COOKIE_SECURE": "true",
            "COOKIE_DOMAIN": cookie_domain, "TRUST_PROXY": "1", "WHATSAPP_DEV_CONNECT": "false",
            "SYSTEM_PING_ENABLED": "false", "NODE_OPTIONS": "--max-old-space-size=512",
            **pick(SERVER_VARS + BILLING_VARS + ["JWT_PRIVATE_KEY", "JWT_PUBLIC_KEY",
                                                 "API_KEY_PEPPER", "META_WEBHOOK_VERIFY_TOKEN",
                                                 "META_ES_CONFIG_ID"]),
        },
        "worker": {
            **SHARED_SERVER, **managed, "APP_VERSION": args.release,
            "WORKER_HEALTH_HOST": "127.0.0.1",
            "WORKER_HEALTH_PORT": "4100", "WEB_ORIGIN": web_origin,
            "NODE_OPTIONS": "--max-old-space-size=768",
            # ADR-0027 item C: replies to no-reply@fenwira.com go to the team mailbox.
            "MAIL_REPLY_TO": params.get("config/mail-reply-to", "fenwira@zenteqk.com"),
            **pick(SERVER_VARS + BILLING_VARS + ["SMTP_URL", "MAIL_FROM", "OPS_ALERT_EMAIL"]),
        },
        "web": {
            "NODE_ENV": "production", "NEXT_TELEMETRY_DISABLED": "1", "HOSTNAME": "127.0.0.1",
            "PORT": "3000", "WEB_ORIGIN": web_origin, "API_INTERNAL_URL": "http://127.0.0.1:4000",
            "ENABLE_UI_GALLERY": "false", "NODE_OPTIONS": "--max-old-space-size=384",
        },
        "migrate": {"NODE_ENV": "production", **pick(["MIGRATION_DATABASE_URL"])},
    }

    os.makedirs(args.out, exist_ok=True)
    blocked = False
    for name, values in files.items():
        mode = 0o600 if name == "migrate" else 0o640
        group = "root" if name == "migrate" else "fenwira"
        write_env(os.path.join(args.out, f"{name}.env"), values, mode, group)
        missing = [k for k in REQUIRED[name] if k not in values]
        print(f"[fenwira] wrote {args.out}/{name}.env ({len(values)} variables, mode {oct(mode)[2:]})"
              + (f"; MISSING required: {', '.join(missing)}" if missing else ""))
        blocked |= bool(missing)
    sys.exit(3 if blocked else 0)


if __name__ == "__main__":
    main()
