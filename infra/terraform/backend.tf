# Reuses the existing shared ZenteqK state bucket (us-east-1; versioned, SSE-S3, public access
# blocked, TLS-only policy). Fenwira v1 already uses internal/fenwira/prod, so v2 has its own key.
# Locking is S3-native (`use_lockfile`), so no DynamoDB table is needed.
terraform {
  backend "s3" {
    bucket       = "zenteqk-platform-tfstate-shared"
    key          = "internal/fenwira-v2/prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
