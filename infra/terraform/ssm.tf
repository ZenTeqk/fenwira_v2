# Non-secret configuration only. Secret values (database passwords, JWT keys, encryption keys,
# Meta secrets, the SMTP URL of the provider chosen later, API key pepper) are written with `aws ssm put-parameter` as
# SecureString under /fenwira/prod/secrets/ (README.md → Credentials) and are never managed here:
# Terraform stores managed parameter values in state, including SecureStrings.

locals {
  config_parameters = {
    "aws-region"         = var.aws_region
    "app-domain"         = var.use_primary_domains ? var.primary_app_domain : var.app_domain
    "api-domain"         = var.use_primary_domains ? var.primary_api_domain : var.api_domain
    "rds-endpoint"       = aws_db_instance.this.address
    "rds-port"           = tostring(aws_db_instance.this.port)
    "rds-database"       = "fenwira"
    "s3-bucket-media"    = aws_s3_bucket.this["media"].bucket
    "s3-bucket-imports"  = aws_s3_bucket.this["imports"].bucket
    "s3-bucket-exports"  = aws_s3_bucket.this["exports"].bucket
    "s3-endpoint"        = "https://s3.${var.aws_region}.amazonaws.com"
    "rds-ca-bundle-path" = "/etc/fenwira/rds-global-bundle.pem"
  }
}

resource "aws_ssm_parameter" "config" {
  for_each    = local.config_parameters
  name        = "${local.ssm_prefix}/config/${each.key}"
  description = "Fenwira v2 non-secret configuration (Terraform-managed)"
  type        = "String"
  value       = each.value
}

resource "aws_ssm_parameter" "cloudwatch_agent_config" {
  name        = "${local.ssm_prefix}/config/cloudwatch-agent"
  description = "CloudWatch agent configuration for the Fenwira v2 app server"
  type        = "String"
  tier        = "Standard"
  value = jsonencode({
    agent = { run_as_user = "cwagent", metrics_collection_interval = 60 }
    metrics = {
      namespace         = "CWAgent"
      append_dimensions = { InstanceId = "$${aws:InstanceId}" }
      metrics_collected = {
        mem  = { measurement = ["mem_used_percent", "mem_available"] }
        swap = { measurement = ["swap_used_percent"] }
        disk = { measurement = ["used_percent"], resources = ["/"], ignore_file_system_types = ["sysfs", "devtmpfs", "tmpfs", "overlay", "squashfs"] }
      }
    }
    logs = {
      logs_collected = {
        files = {
          collect_list = concat(
            [for s in ["api", "worker", "web"] : {
              file_path       = "/var/log/fenwira/${s}.log"
              log_group_name  = aws_cloudwatch_log_group.this[s].name
              log_stream_name = "{instance_id}"
              timezone        = "UTC"
            }],
            [
              { file_path = "/var/log/nginx/*.log", log_group_name = aws_cloudwatch_log_group.this["nginx"].name, log_stream_name = "{instance_id}", timezone = "UTC" },
              { file_path = "/var/log/syslog", log_group_name = aws_cloudwatch_log_group.this["system"].name, log_stream_name = "{instance_id}", timezone = "UTC" },
            ],
          )
        }
      }
    }
  })
}

# Second agent configuration, appended to the first (amazon-cloudwatch-agent-ctl -a append-config):
# the local EMF listener (UDP 127.0.0.1:25888 only, fed by deploy/monitoring/redis-metrics.sh) and process
# counts for the Fenwira services. Kept separate so the base configuration is never rewritten.
resource "aws_ssm_parameter" "cloudwatch_agent_extra" {
  name        = "${local.ssm_prefix}/config/cloudwatch-agent-extra"
  description = "CloudWatch agent: EMF listener (Redis metrics) and Fenwira process checks"
  type        = "String"
  tier        = "Standard"
  value = jsonencode({
    # Loopback only (UDP): the default would listen on every interface, TCP and UDP.
    logs = { metrics_collected = { emf = { service_address = "udp://127.0.0.1:25888" } } }
    metrics = {
      namespace         = "CWAgent"
      append_dimensions = { InstanceId = "$${aws:InstanceId}" }
      metrics_collected = {
        procstat = [for s in local.app_processes : {
          pattern                     = s.pattern
          measurement                 = ["pid_count"]
          metrics_collection_interval = 60
        }]
      }
    }
  })
}
