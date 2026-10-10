resource "aws_db_parameter_group" "this" {
  name        = "${local.name}-pg16"
  family      = "postgres16"
  description = "Fenwira v2 PostgreSQL 16"

  # Reject unencrypted connections (the app verifies the server certificate:
  # docs/deployment/PRODUCTION_RUNTIME.md → Database TLS).
  # Also the PostgreSQL 16 default on RDS (Source = system); AWS reports it as pending-reboot,
  # so the same apply method is declared to keep plans free of perpetual diffs.
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
}

resource "aws_db_instance" "this" {
  identifier = "${local.name}-db"

  engine                      = "postgres"
  engine_version              = var.db_engine_version
  instance_class              = var.db_instance_class
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false
  parameter_group_name        = aws_db_parameter_group.this.name
  ca_cert_identifier          = "rds-ca-rsa2048-g1"

  # Storage: gp3, encrypted with the AWS-managed aws/rds key (no customer-managed KMS key).
  storage_type          = "gp3"
  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_max_allocated_storage_gb == 0 ? null : var.db_max_allocated_storage_gb
  storage_encrypted     = true

  # Private, Single-AZ, next to the app server.
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  availability_zone      = var.availability_zone
  multi_az               = false
  publicly_accessible    = false
  port                   = 5432

  # The master password is generated and stored by RDS in Secrets Manager; it never appears in
  # Terraform state or variables. Application roles are created by deploy/sql/bootstrap-roles.sql.
  username                    = var.db_master_username
  manage_master_user_password = true

  # No initial database: bootstrap-roles.sql creates `fenwira` owned by fenwira_owner.
  db_name = null

  backup_retention_period   = var.db_backup_retention_days
  backup_window             = "20:30-21:00" # 02:00–02:30 IST
  maintenance_window        = "sun:21:30-sun:22:30"
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-db-final"

  # PostgreSQL log (slow statements ≥ 1 s, errors) to CloudWatch; group pre-created with retention.
  enabled_cloudwatch_logs_exports = ["postgresql"]

  performance_insights_enabled = false
  monitoring_interval          = 0
  apply_immediately            = false

  tags = { Name = "${local.name}-db" }

  depends_on = [aws_cloudwatch_log_group.rds_postgresql]

  lifecycle {
    # Minor versions advance through auto_minor_version_upgrade; don't fight them in plans.
    ignore_changes = [engine_version]
  }
}
