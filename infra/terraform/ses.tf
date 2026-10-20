# Amazon SES for application email (worker SMTP: verification, invitations, password reset,
# notifications, operational alerts). Decision 2026-10-20 (owner): SES, replacing the 2026-10-09
# "not provisioned" decision. The account is already out of the SES sandbox in this region.
#
# Terraform owns the domain identity (Easy DKIM), the custom MAIL FROM domain, their Route 53
# records and an SMTP-only IAM user. It never creates access keys: SMTP credentials are minted out
# of band by deploy/scripts/ses-smtp-credentials.py straight into SSM SecureString parameters
# (README.md → Credentials), so no secret ever lands in Terraform state.

resource "aws_sesv2_email_identity" "mail" {
  count          = var.manage_ses ? 1 : 0
  email_identity = var.mail_domain
}

# Easy DKIM always issues three tokens.
resource "aws_route53_record" "ses_dkim" {
  count           = var.manage_ses ? 3 : 0
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = "${aws_sesv2_email_identity.mail[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.mail_domain}"
  type            = "CNAME"
  ttl             = 1800
  records         = ["${aws_sesv2_email_identity.mail[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
  allow_overwrite = false
}

# Custom MAIL FROM so SPF aligns with the sending domain (DMARC), not amazonses.com.
resource "aws_sesv2_email_identity_mail_from_attributes" "mail" {
  count                  = var.manage_ses ? 1 : 0
  email_identity         = aws_sesv2_email_identity.mail[0].email_identity
  mail_from_domain       = "${var.mail_from_subdomain}.${var.mail_domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  count           = var.manage_ses ? 1 : 0
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = "${var.mail_from_subdomain}.${var.mail_domain}"
  type            = "MX"
  ttl             = 1800
  records         = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
  allow_overwrite = false
}

resource "aws_route53_record" "ses_mail_from_spf" {
  count           = var.manage_ses ? 1 : 0
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = "${var.mail_from_subdomain}.${var.mail_domain}"
  type            = "TXT"
  ttl             = 1800
  records         = ["v=spf1 include:amazonses.com ~all"]
  allow_overwrite = false
}

# SMTP-only principal: may send raw email from the Fenwira domain identity and nothing else.
resource "aws_iam_user" "ses_smtp" {
  count = var.manage_ses ? 1 : 0
  name  = "${local.name}-ses-smtp"
  path  = "/system/"
}

data "aws_iam_policy_document" "ses_smtp" {
  count = var.manage_ses ? 1 : 0
  statement {
    actions   = ["ses:SendRawEmail"]
    resources = [aws_sesv2_email_identity.mail[0].arn]
    condition {
      test     = "StringLike"
      variable = "ses:FromAddress"
      values   = ["*@${var.mail_domain}"]
    }
  }
}

resource "aws_iam_user_policy" "ses_smtp" {
  count  = var.manage_ses ? 1 : 0
  name   = "ses-send-from-${replace(var.mail_domain, ".", "-")}"
  user   = aws_iam_user.ses_smtp[0].name
  policy = data.aws_iam_policy_document.ses_smtp[0].json
}
