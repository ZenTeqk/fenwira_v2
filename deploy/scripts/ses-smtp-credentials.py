#!/usr/bin/env python3
"""Mint SES SMTP credentials for the worker and store them in SSM, without exposing the secret.

Creates an access key for the SMTP-only IAM user from infra/terraform/ses.tf, derives the SES SMTP
password from it (AWS "Obtaining SES SMTP credentials" algorithm, signature version 4), and writes
    <prefix>/secrets/smtp-url   smtp://<key-id>:<password>@email-smtp.<region>.amazonaws.com:587?requireTLS=true
    <prefix>/secrets/mail-from  e.g. Fenwira <no-reply@fenwira.com>
as SecureString parameters (aws/ssm), which render-env-from-ssm.py turns into SMTP_URL / MAIL_FROM.
The secret key and password are never printed or written to disk; values reach the AWS CLI via
chmod 600 temporary files that are deleted afterwards. Only the access key ID is printed.

Run from a trusted workstation with admin credentials, after `terraform apply` with manage_ses:
    AWS_PROFILE=default deploy/scripts/ses-smtp-credentials.py \\
        --user zenteqk-internal-fenwira-v2-prod-ses-smtp \\
        --mail-from 'Fenwira <no-reply@fenwira.com>'
Then re-render env files on the server (deploy-release.sh does it) and restart the worker.

Rotation: run again (a user may hold two keys), redeploy, then delete the old key with
`aws iam delete-access-key --user-name <user> --access-key-id <old id>`.
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import urllib.parse


def smtp_password(secret_key: str, region: str) -> str:
    def sign(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    signature = sign(("AWS4" + secret_key).encode("utf-8"), "11111111")
    for part in (region, "ses", "aws4_request", "SendRawEmail"):
        signature = sign(signature, part)
    return base64.b64encode(bytes([0x04]) + signature).decode("utf-8")


def aws(*args: str) -> str:
    return subprocess.run(["aws", *args], check=True, capture_output=True, text=True).stdout


def put_secure(name: str, value: str, region: str) -> None:
    fd, path = tempfile.mkstemp(prefix="fenwira-ssm-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(value)
        aws("ssm", "put-parameter", "--region", region, "--name", name, "--type", "SecureString",
            "--overwrite", "--value", f"file://{path}")
    finally:
        os.unlink(path)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--user", required=True, help="SMTP-only IAM user (terraform output ses_smtp_user)")
    p.add_argument("--mail-from", required=True, help="Sender, at the SES domain identity")
    p.add_argument("--region", default="ap-south-1")
    p.add_argument("--prefix", default="/fenwira/prod")
    a = p.parse_args()

    if "@" not in a.mail_from:
        p.error("--mail-from must contain an email address")
    keys = json.loads(aws("iam", "list-access-keys", "--user-name", a.user))["AccessKeyMetadata"]
    if len(keys) >= 2:
        print(f"{a.user} already has 2 access keys; delete the unused one first.", file=sys.stderr)
        return 1

    key = json.loads(aws("iam", "create-access-key", "--user-name", a.user))["AccessKey"]
    password = urllib.parse.quote(smtp_password(key["SecretAccessKey"], a.region), safe="")
    # ADR-0027 item C: port 587 with STARTTLS, which nodemailer must not skip (requireTLS).
    url = (
        f"smtp://{key['AccessKeyId']}:{password}@email-smtp.{a.region}.amazonaws.com:587"
        "?requireTLS=true"
    )
    put_secure(f"{a.prefix}/secrets/smtp-url", url, a.region)
    put_secure(f"{a.prefix}/secrets/mail-from", a.mail_from, a.region)
    print(f"Stored SMTP credentials for access key {key['AccessKeyId']} under {a.prefix}/secrets/")
    print("Next: re-render env files on the server and restart the worker.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
