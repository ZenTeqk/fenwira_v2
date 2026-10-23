resource "aws_cloudwatch_log_group" "this" {
  for_each          = toset(local.log_groups)
  name              = "${local.log_group_prefix}/${each.key}"
  retention_in_days = var.log_retention_days
}

# RDS would otherwise create this group itself with "never expire" retention.
resource "aws_cloudwatch_log_group" "rds_postgresql" {
  name              = "/aws/rds/instance/${local.name}-db/postgresql"
  retention_in_days = var.log_retention_days
}

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email # must be confirmed from the email AWS sends
}

locals {
  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = local.alarm_ok_actions
  # "Recovered" notifications (OK state). Off until a recipient is subscribed (alarm_recovery_notifications).
  alarm_ok_actions = var.alarm_recovery_notifications ? [aws_sns_topic.alarms.arn] : []
}

# ---- EC2 ------------------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "ec2_system_check" {
  alarm_name          = "${local.name}-ec2-system-check"
  alarm_description   = "Underlying host failed: recover the instance automatically (same ID, IP, volume)."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = concat(local.alarm_actions, ["arn:aws:automate:${var.aws_region}:ec2:recover"])
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "ec2_instance_check" {
  alarm_name          = "${local.name}-ec2-instance-check"
  alarm_description   = "Instance status check failing (OS-level problem)."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "ec2_cpu_credits" {
  alarm_name          = "${local.name}-ec2-cpu-credits-low"
  alarm_description   = "Burst credits nearly exhausted: CPU will be throttled to baseline (cpu_credits = standard)."
  namespace           = "AWS/EC2"
  metric_name         = "CPUCreditBalance"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 30
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "ec2_memory" {
  alarm_name          = "${local.name}-ec2-memory-high"
  alarm_description   = "Memory used above 85% for 10 minutes (RESOURCE_BUDGET.md)."
  namespace           = "CWAgent"
  metric_name         = "mem_used_percent"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "ec2_disk" {
  alarm_name          = "${local.name}-ec2-disk-high"
  alarm_description   = "Root filesystem above 80%."
  namespace           = "CWAgent"
  metric_name         = "disk_used_percent"
  dimensions          = { InstanceId = aws_instance.app.id, path = "/", device = "nvme0n1p1", fstype = "ext4" }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

# ---- RDS ------------------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-cpu-high"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${local.name}-rds-storage-low"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3 * 1024 * 1024 * 1024 # 3 GiB
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_memory" {
  alarm_name          = "${local.name}-rds-memory-low"
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 100 * 1024 * 1024 # 100 MiB (db.t4g.micro has 1 GiB)
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_credits" {
  alarm_name          = "${local.name}-rds-cpu-credits-low"
  namespace           = "AWS/RDS"
  metric_name         = "CPUCreditBalance"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 20
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

# ---- Added for Stage 2 requirements: CPU, connections, Redis, service availability -------------
resource "aws_cloudwatch_metric_alarm" "ec2_cpu" {
  alarm_name          = "${local.name}-ec2-cpu-high"
  alarm_description   = "CPU above 80% for 15 minutes (t3a.medium baseline is 20%; sustained load also drains credits)."
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${local.name}-rds-connections-high"
  alarm_description   = "Connections above 60 (db.t4g.micro max_connections = 79, 3 reserved; app pools ≈ 20)."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 60
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "redis_up" {
  alarm_name          = "${local.name}-redis-down"
  alarm_description   = "Redis not answering PING (or the metrics timer stopped): queues, sessions and realtime fail."
  namespace           = "CWAgent"
  metric_name         = "redis_up"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  alarm_name          = "${local.name}-redis-memory-high"
  alarm_description   = "Redis used_memory above 75% of maxmemory (noeviction: writes are refused at 100%)."
  namespace           = "CWAgent"
  metric_name         = "redis_used_memory_percent"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 75
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

resource "aws_cloudwatch_metric_alarm" "app_process" {
  for_each            = local.app_processes
  alarm_name          = "${local.name}-${each.key}-down"
  alarm_description   = "fenwira-${each.key} process not running. Notifications enabled per service once deployed (app_alarm_services)."
  namespace           = "CWAgent"
  metric_name         = "procstat_lookup_pid_count"
  dimensions          = { InstanceId = aws_instance.app.id, pattern = each.value.pattern, pid_finder = "native" }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  actions_enabled     = contains(var.app_alarm_services, each.key)
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

# ---------------------------------------------------------------------------------------------
# ADR-0027 item E: launch alarms (to the alarms topic, i.e. alarm_email).
# ---------------------------------------------------------------------------------------------

# API 5xx: the API's exception filter logs every ≥500 response as {"msg":"request failed"}.
resource "aws_cloudwatch_log_metric_filter" "api_5xx" {
  name           = "${local.name}-api-5xx"
  log_group_name = aws_cloudwatch_log_group.this["api"].name
  pattern        = "{ $.msg = \"request failed\" }"
  metric_transformation {
    name          = "api_5xx"
    namespace     = "Fenwira"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-5xx"
  alarm_description   = "5 or more API 5xx responses in 5 minutes (api log: \"request failed\")."
  namespace           = "Fenwira"
  metric_name         = "api_5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

# Worker heartbeat: /health/live probed every minute by deploy/monitoring/redis-metrics.sh. Missing
# data (timer stopped) counts as down. Notifies only once the worker is in app_alarm_services.
resource "aws_cloudwatch_metric_alarm" "worker_heartbeat" {
  alarm_name          = "${local.name}-worker-no-heartbeat"
  alarm_description   = "Worker /health/live not answering for 3 minutes: no webhooks processed, no sends, no email."
  namespace           = "CWAgent"
  metric_name         = "worker_up"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  actions_enabled     = contains(var.app_alarm_services, "worker")
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}

# Queue backlog: the oldest waiting job on a customer-traffic queue is older than 5 minutes.
resource "aws_cloudwatch_metric_alarm" "queue_backlog_age" {
  alarm_name          = "${local.name}-queue-backlog-age"
  alarm_description   = "Oldest waiting job older than 5 minutes for 3 minutes (inbound, status, outbound, campaigns, email…)."
  namespace           = "CWAgent"
  metric_name         = "queue_backlog_age_seconds"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_ok_actions
}
