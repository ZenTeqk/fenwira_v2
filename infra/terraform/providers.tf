provider "aws" {
  region = var.aws_region

  # Refuse to run against any account other than the ZenteqK account.
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = local.common_tags
  }
}
