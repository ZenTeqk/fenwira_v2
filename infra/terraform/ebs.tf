# The root volume itself (40 GB gp3, encrypted with aws/ebs) is declared in ec2.tf. Optional daily
# snapshots of it (Redis AOF, configs, releases); RDS has its own automated backups.
# Off by default to keep cost predictable (enable_ebs_snapshots).

data "aws_iam_policy_document" "dlm_assume" {
  count = var.enable_ebs_snapshots ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  count              = var.enable_ebs_snapshots ? 1 : 0
  name               = "${local.name}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume[0].json
}

resource "aws_iam_role_policy_attachment" "dlm" {
  count      = var.enable_ebs_snapshots ? 1 : 0
  role       = aws_iam_role.dlm[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "root" {
  count              = var.enable_ebs_snapshots ? 1 : 0
  description        = "Fenwira v2 app server root volume daily snapshots keep 7"
  execution_role_arn = aws_iam_role.dlm[0].arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Name = "${local.name}-root" }

    schedule {
      name = "daily"
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["21:00"]
      }
      retain_rule {
        count = 7
      }
      copy_tags = true
    }
  }
}
