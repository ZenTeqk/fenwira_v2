# Amazon SES for application email (ADR-0027 item C): invitations, owner setup and password links,
# notifications, operational alerts. Sender "Fenwira <no-reply@fenwira.com>", Reply-To
# fenwira@zenteqk.com (worker MAIL_FROM / MAIL_REPLY_TO). The account has SES production access in
# ap-south-1 (checked 2026-10-23: ProductionAccessEnabled, review GRANTED).
#
# Terraform owns the domain identity (Easy DKIM), the custom MAIL FROM domain, DMARC, their
# Route 53 records in the existing fenwira.com zone, the configuration set that reports bounces and
# complaints to SNS, the bounce/complaint alarms and an SMTP-only IAM user. It never creates access
# keys: deploy/scripts/ses-smtp-credentials.py mints them straight into SSM SecureString parameters,
# so no secret is ever in Terraform state, logs or the repository.

resource "aws_sesv2_configuration_set" "mail" {
  count                  = var.manage_ses ? 1 : 0
  configuration_set_name = "${local.name}-mail"
  reputation_options {
    reputation_metrics_enabled = true
  }
  # SES itself refuses later sends to addresses that hard-bounced or complained (cheap suppression;
  # the app's email_suppressions table stays available for its own use).
  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
  sending_options {
    sending_enabled = true
  }
}

resource "aws_sesv2_email_identity" "mail" {
  count                  = var.manage_ses ? 1 : 0
  email_identity         = var.mail_domain
  configuration_set_name = aws_sesv2_configuration_set.mail[0].configuration_set_name
}

# Easy DKIM always issues three tokens.
resource "aws_route53_record" "ses_dkim" {
  count           = var.manage_ses ? 3 : 0
  zone_id         = data.aws_route53_zone.primary.zone_id
  name            = "${aws_sesv2_email_identity.mail[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.mail_domain}"
  type            = "CNAME"
  ttl             = 1800
  records         = ["${aws_sesv2_email_identity.mail[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
  allow_overwrite = false
}

# Custom MAIL FROM (bounce.fenwira.com) so SPF aligns with the sending domain for DMARC.
resource "aws_sesv2_email_identity_mail_from_attributes" "mail" {
  count                  = var.manage_ses ? 1 : 0
  email_identity         = aws_sesv2_email_identity.mail[0].email_identity
  mail_from_domain       = "${var.mail_from_subdomain}.${var.mail_domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  count           = var.manage_ses ? 1 : 0
  zone_id         = data.aws_route53_zone.primary.zone_id
  name            = "${var.mail_from_subdomain}.${var.mail_domain}"
  type            = "MX"
  ttl             = 1800
  records         = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
  allow_overwrite = false
}

resource "aws_route53_record" "ses_mail_from_spf" {
  count           = var.manage_ses ? 1 : 0
  zone_id         = data.aws_route53_zone.primary.zone_id
  name            = "${var.mail_from_subdomain}.${var.mail_domain}"
  type            = "TXT"
  ttl             = 1800
  records         = ["v=spf1 include:amazonses.com ~all"]
  allow_overwrite = false
}

# DMARC, monitoring only (p=none) while sending ramps up.
resource "aws_route53_record" "dmarc" {
  count           = var.manage_ses ? 1 : 0
  zone_id         = data.aws_route53_zone.primary.zone_id
  name            = "_dmarc.${var.mail_domain}"
  type            = "TXT"
  ttl             = 1800
  records         = ["v=DMARC1; p=none; rua=mailto:${var.dmarc_report_email}"]
  allow_overwrite = false
}

# The report address is on another domain (zenteqk.com): it must authorize receiving fenwira.com
# reports (RFC 7489 §7.1), or receivers drop them.
resource "aws_route53_record" "dmarc_report_authorization" {
  count           = var.manage_ses && endswith(var.dmarc_report_email, "@${var.route53_zone_name}") ? 1 : 0
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = "${var.mail_domain}._report._dmarc.${var.route53_zone_name}"
  type            = "TXT"
  ttl             = 1800
  records         = ["v=DMARC1"]
  allow_overwrite = false
}

# Bounces and complaints → SNS (emailed to the alarm address; no SQS pipeline at launch).
resource "aws_sns_topic" "ses_events" {
  count = var.manage_ses ? 1 : 0
  name  = "${local.name}-ses-events"
}

data "aws_iam_policy_document" "ses_events" {
  count = var.manage_ses ? 1 : 0
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.ses_events[0].arn]
    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [var.aws_account_id]
    }
  }
}

resource "aws_sns_topic_policy" "ses_events" {
  count  = var.manage_ses ? 1 : 0
  arn    = aws_sns_topic.ses_events[0].arn
  policy = data.aws_iam_policy_document.ses_events[0].json
}

resource "aws_sns_topic_subscription" "ses_events_email" {
  count     = var.manage_ses && var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.ses_events[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email # confirm from the email AWS sends
}

resource "aws_sesv2_configuration_set_event_destination" "bounces" {
  count                  = var.manage_ses ? 1 : 0
  configuration_set_name = aws_sesv2_configuration_set.mail[0].configuration_set_name
  event_destination_name = "bounces-complaints-sns"
  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE", "COMPLAINT", "REJECT"]
    sns_destination {
      topic_arn = aws_sns_topic.ses_events[0].arn
    }
  }
  depends_on = [aws_sns_topic_policy.ses_events]
}

# Account reputation: AWS reviews accounts above ~5 % bounces or ~0.1 % complaints.
resource "aws_cloudwatch_metric_alarm" "ses_bounce_rate" {
  count               = var.manage_ses ? 1 : 0
  alarm_name          = "${local.name}-ses-bounce-rate"
  alarm_description   = "SES bounce rate above 4 % (AWS review starts near 5 %)."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.BounceRate"
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0.04
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "ses_complaint_rate" {
  count               = var.manage_ses ? 1 : 0
  alarm_name          = "${local.name}-ses-complaint-rate"
  alarm_description   = "SES complaint rate above 0.08 % (AWS review starts near 0.1 %)."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.ComplaintRate"
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0.0008
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
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
    actions = ["ses:SendRawEmail"]
    resources = [
      aws_sesv2_email_identity.mail[0].arn,
      aws_sesv2_configuration_set.mail[0].arn,
    ]
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
