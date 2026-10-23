# ---------------------------------------------------------------------------------------------
# EC2 instance role: S3 (the three Fenwira buckets), SSM parameters under /fenwira/prod,
# Session Manager, and the CloudWatch agent. No static AWS keys on the server (Phase 1 P2).
# ---------------------------------------------------------------------------------------------
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "${local.name}-ec2"
  description        = "Fenwira v2 app server"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${local.name}-ec2"
  role = aws_iam_role.ec2.name
}

# Session Manager (shell access without SSH or inbound ports).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "ec2_app" {
  statement {
    sid       = "ListFenwiraBuckets"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [for b in aws_s3_bucket.this : b.arn]
  }

  statement {
    sid       = "ReadWriteFenwiraObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = [for b in aws_s3_bucket.this : "${b.arn}/*"]
  }

  statement {
    sid     = "ReadFenwiraParameters"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}",
      "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}/*",
    ]
  }

  # AmazonSSMManagedInstanceCore (needed for Session Manager) allows ssm:GetParameter(s) on every
  # parameter in the account. Explicitly deny reads outside Fenwira's tree, so this instance can never
  # read (and, with kms:Decrypt below, decrypt) another application's SecureStrings.
  statement {
    sid    = "DenyParametersOutsideFenwira"
    effect = "Deny"
    actions = [
      "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory",
    ]
    not_resources = [
      "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}",
      "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}/*",
    ]
  }

  statement {
    sid       = "DecryptSecureStringsViaSsm"
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }

  # CloudWatch agent: only Fenwira's log groups, metrics in its own namespace, and its config.
  statement {
    sid       = "AgentLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = [for g in aws_cloudwatch_log_group.this : "${g.arn}:*"]
  }

  statement {
    sid       = "AgentDescribeLogGroups"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  statement {
    sid       = "AgentMetrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["CWAgent"]
    }
  }

  statement {
    sid       = "AgentInstanceTags"
    actions   = ["ec2:DescribeTags", "ec2:DescribeVolumes", "ec2:DescribeInstances"]
    resources = ["*"]
  }

  # certbot DNS-01 (python3-certbot-dns-route53): issue Let's Encrypt certificates before the DNS
  # cutover, without touching the live A/AAAA records. Only TXT records named
  # _acme-challenge.<app_domain|api_domain> can be changed.
  statement {
    sid       = "AcmeDns01Change"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = [data.aws_route53_zone.this.arn]
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      values   = ["_acme-challenge.${var.app_domain}", "_acme-challenge.${var.api_domain}"]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsRecordTypes"
      values   = ["TXT"]
    }
  }

  # The same, for the fenwira.com certificate (app, api and the company site on one certificate).
  statement {
    sid       = "AcmeDns01ChangePrimary"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = [data.aws_route53_zone.primary.arn]
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      values = [
        "_acme-challenge.${var.primary_app_domain}",
        "_acme-challenge.${var.primary_api_domain}",
        "_acme-challenge.${var.site_domain}",
      ]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsRecordTypes"
      values   = ["TXT"]
    }
  }

  statement {
    sid       = "AcmeDns01Lookup"
    actions   = ["route53:ListHostedZones", "route53:GetChange"]
    resources = ["*"]
  }

  statement {
    sid       = "AgentConfig"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.cloudwatch_agent_config.arn]
  }
}

resource "aws_iam_role_policy" "ec2_app" {
  name   = "fenwira-app"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ec2_app.json
}
