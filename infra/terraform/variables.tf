# ---------------------------------------------------------------------------------------------
# Account and placement
# ---------------------------------------------------------------------------------------------
variable "aws_account_id" {
  description = "ZenteqK AWS account ID. The provider refuses to run against any other account."
  type        = string
  default     = "569476542351"
}

variable "aws_region" {
  description = "Region for every Fenwira v2 resource."
  type        = string
  default     = "ap-south-1"
}

variable "vpc_id" {
  description = "Existing VPC to reuse (the account's default VPC in ap-south-1). Not created or modified."
  type        = string
  default     = "vpc-038deffeecb93ad2f"
}

variable "availability_zone" {
  description = "AZ for the EC2 instance and the (Single-AZ) RDS instance, kept together for latency."
  type        = string
  default     = "ap-south-1a"
}

variable "private_subnet_name_pattern" {
  description = "Name tag pattern of the existing private subnets used for the RDS subnet group."
  type        = string
  default     = "RDS-Pvt-subnet-*"
}

# ---------------------------------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------------------------------
variable "name_prefix" {
  description = "Prefix for every resource name. v1 owns zenteqk-internal-fenwira-prod-*, so v2 is distinct."
  type        = string
  default     = "zenteqk-internal-fenwira-v2-prod"
}

# ---------------------------------------------------------------------------------------------
# Domains and DNS (no records are created until manage_dns = true)
# ---------------------------------------------------------------------------------------------
variable "app_domain" {
  description = "Public host name of the web app (Next.js). Served by this server since the 2026-10-10 cutover (the v1 CloudFront records were removed)."
  type        = string
  default     = "app.fenwira.zenteqk.com"
}

variable "api_domain" {
  description = "Public host name of the API and Meta webhooks (NestJS). Compiled into the web bundle (NEXT_PUBLIC_API_URL)."
  type        = string
  default     = "api.fenwira.zenteqk.com"
}

variable "manage_dns" {
  description = "Create A records for app_domain and api_domain pointing at this server. allow_overwrite = false: Terraform fails instead of taking over a record another state owns."
  type        = bool
  default     = false
}

variable "dns_ttl" {
  description = "TTL (seconds) of the app/api A records. 60 during the cutover window for fast rollback; raise (e.g. 300) once stable."
  type        = number
  default     = 60
}

variable "route53_zone_name" {
  description = "Existing Route 53 public hosted zone holding app_domain/api_domain (read only; also scopes the certbot DNS-01 permission)."
  type        = string
  default     = "zenteqk.com"
}


# ---------------------------------------------------------------------------------------------
# EC2
# ---------------------------------------------------------------------------------------------
variable "instance_type" {
  description = "Fenwira application server (web, API, worker, Redis, nginx)."
  type        = string
  default     = "t3a.medium"
}

variable "cpu_credits" {
  description = "Burstable CPU credit mode. 'standard' caps cost (throttles to baseline when credits run out); 'unlimited' never throttles but bills surplus credits."
  type        = string
  default     = "standard"

  validation {
    condition     = contains(["standard", "unlimited"], var.cpu_credits)
    error_message = "cpu_credits must be standard or unlimited."
  }
}

variable "root_volume_size_gb" {
  description = "Encrypted gp3 root volume."
  type        = number
  default     = 40
}

variable "swap_size_gb" {
  description = "Swap file created at bootstrap (docs/deployment/RESOURCE_BUDGET.md)."
  type        = number
  default     = 2
}

variable "node_major_version" {
  description = "Node.js major installed from NodeSource (matches .nvmrc)."
  type        = number
  default     = 22
}

variable "enable_ebs_snapshots" {
  description = "Daily Data Lifecycle Manager snapshots of the EC2 root volume (Redis AOF, configs). RDS has its own backups."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------------------------
# RDS
# ---------------------------------------------------------------------------------------------
variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "PostgreSQL version. Minor upgrades are applied automatically in the maintenance window."
  type        = string
  default     = "16.15"
}

variable "db_allocated_storage_gb" {
  description = "Initial gp3 storage (20 GB is the gp3 minimum for PostgreSQL)."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling (billed only when used). 0 disables autoscaling."
  type        = number
  default     = 50
}

variable "db_backup_retention_days" {
  description = "Automated backup retention."
  type        = number
  default     = 7
}

variable "db_master_username" {
  description = "RDS master user. Its password is generated and kept by RDS in Secrets Manager (never in Terraform state)."
  type        = string
  default     = "fenwira_admin"
}

variable "db_deletion_protection" {
  description = "Prevent accidental deletion of the production database."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------------------------
# Monitoring
# ---------------------------------------------------------------------------------------------
variable "log_retention_days" {
  description = "CloudWatch Logs retention for the application, nginx and system logs."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Email subscribed to the alarm SNS topic (subscription must be confirmed by email). Empty = alarms without notifications."
  type        = string
  default     = ""
}

variable "alarm_recovery_notifications" {
  description = "Also notify the alarm topic when an alarm returns to OK. Enable together with the SNS subscription (alarm_email)."
  type        = bool
  default     = false
}

variable "app_alarm_services" {
  description = "Services whose availability alarm has notifications enabled. Add a service only once it is deployed and meant to run (the worker stays out while SMTP is unconfigured)."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for s in var.app_alarm_services : contains(["api", "worker", "web"], s)])
    error_message = "app_alarm_services may contain only api, worker and web."
  }
}

variable "github_oidc_subject_prefix" {
  description = "GitHub OIDC subject prefix of the repository allowed to deploy (immutable format: repo:<owner>@<owner-id>/<repo>@<repo-id>)."
  type        = string
  default     = "repo:ZenTeqk@304040444/fenwira_v2@1396213834"
  validation {
    condition     = can(regex("^repo:[^:*]+$", var.github_oidc_subject_prefix))
    error_message = "Must be an exact repo: subject prefix without wildcards."
  }
}

variable "github_deploy_branch" {
  description = "The only branch whose workflows may assume the deploy role."
  type        = string
  default     = "main"
}
