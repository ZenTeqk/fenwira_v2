# GitHub Actions continuous deployment (.github/workflows/deploy.yml).
#
# GitHub OIDC (no stored AWS keys) → this role → upload the release artifact to the imports bucket
# under _deploy-artifacts/ (whole-bucket 7-day expiry cleans it up) → SSM Run Command with the Fenwira
# deploy document on this instance only. The role cannot run arbitrary commands, read parameters or
# secrets, or touch Terraform, IAM, RDS or DNS. Terraform itself is never run by CI.

locals {
  deploy_artifact_prefix = "_deploy-artifacts"
  # Immutable subject format (repo owner/name with their numeric IDs), as configured for the repository.
  github_deploy_subject = "${var.github_oidc_subject_prefix}:ref:refs/heads/${var.github_deploy_branch}"
}

# The account-wide GitHub OIDC provider already exists (shared with other ZenteqK repositories).
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Only workflows running on this repository's deploy branch: no pull requests, no other branches.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_deploy_subject]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${local.name}-github-deploy"
  description          = "GitHub Actions deploy for Fenwira v2 (OIDC, main branch only): upload release, run the SSM deploy document."
  assume_role_policy   = data.aws_iam_policy_document.github_deploy_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "UploadReleaseArtifacts"
    actions   = ["s3:PutObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.this["imports"].arn}/${local.deploy_artifact_prefix}/*"]
  }

  # SendCommand needs both the target and the document: only this instance, only this document.
  statement {
    sid     = "RunDeployDocumentOnFenwiraInstance"
    actions = ["ssm:SendCommand"]
    resources = [
      aws_instance.app.arn,
      aws_ssm_document.deploy.arn,
    ]
  }

  # Command results; these actions do not support resource-level permissions.
  statement {
    sid       = "ReadDeployResults"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

resource "aws_ssm_document" "deploy" {
  name            = "${local.name}-deploy"
  document_type   = "Command"
  document_format = "YAML"
  target_type     = "/AWS::EC2::Instance"
  content = yamlencode({
    schemaVersion = "2.2"
    description   = "Deploy a Fenwira v2 release built by GitHub Actions (download, verify SHA-256, extract, deploy-release.sh)."
    parameters = {
      release = {
        type           = "String"
        description    = "Full git commit SHA of the release."
        allowedPattern = "^[0-9a-f]{40}$"
      }
      sha256 = {
        type           = "String"
        description    = "SHA-256 of the release tarball."
        allowedPattern = "^[0-9a-f]{64}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = {
        timeoutSeconds = "1800"
        # SSM runs runCommand with /bin/sh (dash on Ubuntu); the script needs bash, and is written
        # to a file first so no child process can read the rest of it from stdin.
        runCommand = concat(
          ["f=$(mktemp /root/fenwira-deploy.XXXXXX)", "cat > \"$f\" <<'FENWIRA_DEPLOY_EOF'"],
          split("\n", trimspace(templatefile("${path.module}/templates/ssm-deploy.sh.tftpl", {
            document_name = "${local.name}-deploy"
            region        = var.aws_region
            bucket        = aws_s3_bucket.this["imports"].id
            prefix        = local.deploy_artifact_prefix
          }))),
          ["FENWIRA_DEPLOY_EOF", "rc=0; bash \"$f\" </dev/null || rc=$?; rm -f \"$f\"; exit $rc"],
        )
      }
    }]
  })
}
