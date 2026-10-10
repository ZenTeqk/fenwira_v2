locals {
  name = var.name_prefix

  common_tags = {
    Project     = "fenwira"
    Application = "fenwira-v2"
    Environment = "prod"
    ManagedBy   = "terraform"
    Repository  = "fenwira_v2/infra/terraform"
  }

  # Only three buckets are used: StorageService reads media, imports and exports
  # (S3_BUCKET_UPLOADS is declared in config but never consumed), see README.md.
  buckets = {
    media   = { name = "${local.name}-media", expire_days = null, versioning = true }
    imports = { name = "${local.name}-imports", expire_days = 7, versioning = false }
    exports = { name = "${local.name}-exports", expire_days = 7, versioning = false }
  }

  # SSM parameter tree read by the instance role. Secret values are created out of band
  # (README.md → Credentials); Terraform only manages non-secret configuration under /config.
  ssm_prefix = "/fenwira/prod"

  # Process patterns for availability alarms (procstat). next-server is how Next.js names its process.
  app_processes = {
    api    = { pattern = "apps/api/dist/main.js" }
    worker = { pattern = "apps/worker/dist/main.js" }
    web    = { pattern = "next-server" }
  }

  log_group_prefix = "/fenwira/v2/prod"
  log_groups       = ["api", "worker", "web", "nginx", "system"]

  # Repository files installed by the bootstrap (single source of truth: Phase 1 deploy assets).
  deploy_dir = "${path.module}/../../deploy"
}
