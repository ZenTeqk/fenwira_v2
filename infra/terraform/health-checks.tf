# Low-cost external monitoring: Route 53 health checks on the public app and api endpoints.
# Route 53 publishes health-check metrics only in us-east-1, and a CloudWatch alarm can notify
# only an SNS topic in its own region, so these alarms use a small us-east-1 topic with the same
# email subscription as the main alarm topic (aws_sns_topic.alarms in var.aws_region).
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = local.common_tags
  }
}

locals {
  health_checks = {
    app = { fqdn = var.app_domain, path = "/login" }
    api = { fqdn = var.api_domain, path = "/health/live" }
  }
}

resource "aws_route53_health_check" "this" {
  for_each          = local.health_checks
  fqdn              = each.value.fqdn
  port              = 443
  type              = "HTTPS"
  resource_path     = each.value.path
  request_interval  = 30
  failure_threshold = 3
  # SNI so nginx serves the right certificate.
  enable_sni = true

  tags = { Name = "${local.name}-${each.key}" }
}

resource "aws_sns_topic" "health_alarms" {
  provider = aws.us_east_1
  name     = "${local.name}-health-alarms"
}

resource "aws_sns_topic_subscription" "health_alarm_email" {
  provider  = aws.us_east_1
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.health_alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email # must be confirmed from the email AWS sends
}

resource "aws_cloudwatch_metric_alarm" "health" {
  provider            = aws.us_east_1
  for_each            = local.health_checks
  alarm_name          = "${local.name}-${each.key}-unhealthy"
  alarm_description   = "Route 53 health check: https://${each.value.fqdn}${each.value.path} failing from multiple regions for 2 minutes."
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.this[each.key].id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.health_alarms.arn]
  ok_actions          = var.alarm_recovery_notifications ? [aws_sns_topic.health_alarms.arn] : []
}

# AWS Budgets: monthly cost alert by email (actual > 80% and forecast > 100%). Off while 0.
resource "aws_budgets_budget" "monthly" {
  count        = var.monthly_budget_usd > 0 ? 1 : 0
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
