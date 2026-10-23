# Three private buckets (media, imports, exports). Objects are always keyed {tenantId}/…; browsers
# reach them only through presigned URLs signed with the instance role (5–15 minute TTL).

resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = each.value.name
  tags     = { Name = each.value.name, Purpose = each.key }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-S3 (AWS-managed keys, no KMS request charges).
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  versioning_configuration {
    status = local.buckets[each.key].versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # Imports and exports are transient (docs/ARCHITECTURE.md: 7-day lifecycle).
  dynamic "rule" {
    for_each = local.buckets[each.key].expire_days == null ? [] : [local.buckets[each.key].expire_days]
    content {
      id     = "expire-transient-files"
      status = "Enabled"
      filter {}
      expiration {
        days = rule.value
      }
    }
  }

  # Media keeps overwritten/deleted versions for 30 days as protection, then removes them.
  dynamic "rule" {
    for_each = local.buckets[each.key].versioning ? [1] : []
    content {
      id     = "expire-noncurrent-versions"
      status = "Enabled"
      filter {}
      noncurrent_version_expiration {
        noncurrent_days = 30
      }
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

# Browsers PUT (uploads) and GET (downloads) with presigned URLs from the web app's origin only.
resource "aws_s3_bucket_cors_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  cors_rule {
    # Both web origins during the move to fenwira.com; the legacy host only redirects afterwards.
    allowed_origins = ["https://${var.app_domain}", "https://${var.primary_app_domain}"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "bucket_tls_only" {
  for_each = aws_s3_bucket.this
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = [each.value.arn, "${each.value.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  for_each   = aws_s3_bucket.this
  bucket     = each.value.id
  policy     = data.aws_iam_policy_document.bucket_tls_only[each.key].json
  depends_on = [aws_s3_bucket_public_access_block.this]
}
