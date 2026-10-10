output "instance_id" {
  description = "Fenwira v2 app server."
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "Elastic IP for app_domain and api_domain A records."
  value       = aws_eip.app.public_ip
}

output "ssm_session_command" {
  description = "Shell access (no SSH)."
  value       = "aws ssm start-session --region ${var.aws_region} --target ${aws_instance.app.id}"
}

output "rds_endpoint" {
  description = "Use this DNS name (never an IP) in DATABASE_URL / MIGRATION_DATABASE_URL."
  value       = aws_db_instance.this.address
}

output "rds_master_secret_arn" {
  description = "Secrets Manager secret holding the RDS master password (managed by RDS)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "s3_buckets" {
  description = "S3_BUCKET_MEDIA / S3_BUCKET_IMPORTS / S3_BUCKET_EXPORTS."
  value       = { for k, b in aws_s3_bucket.this : k => b.bucket }
}

output "ssm_parameter_prefix" {
  description = "Instance-readable parameter tree: /config (Terraform) and /secrets (manual SecureStrings)."
  value       = local.ssm_prefix
}

output "github_deploy_role_arn" {
  description = "Role assumed by .github/workflows/deploy.yml through GitHub OIDC."
  value       = aws_iam_role.github_deploy.arn
}

output "deploy_document_name" {
  description = "SSM document run by the deploy workflow."
  value       = aws_ssm_document.deploy.name
}
