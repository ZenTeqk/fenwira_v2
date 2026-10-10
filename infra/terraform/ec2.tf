resource "aws_instance" "app" {
  # Canonical's current Ubuntu 24.04 amd64 AMI at creation time. Later AMI releases must not
  # replace a running production server, so the AMI (and user data) are ignored after creation.
  ami                    = nonsensitive(data.aws_ssm_parameter.ubuntu_ami.value)
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.ec2.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  # No key pair: shell access is SSM Session Manager only (no port 22 anywhere).
  key_name                    = null
  associate_public_ip_address = true
  disable_api_termination     = true
  monitoring                  = false
  ebs_optimized               = true

  credit_specification {
    cpu_credits = var.cpu_credits
  }

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 1
    http_endpoint               = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    encrypted             = true # AWS-managed aws/ebs key
    delete_on_termination = true
    tags                  = { Name = "${local.name}-root" }
  }

  user_data_base64 = base64gzip(templatefile("${path.module}/templates/bootstrap.sh.tftpl", {
    region                   = var.aws_region
    node_major               = var.node_major_version
    pnpm_version             = "10.34.5"
    swap_size_gb             = var.swap_size_gb
    cw_agent_parameter       = aws_ssm_parameter.cloudwatch_agent_config.name
    cw_agent_extra_parameter = aws_ssm_parameter.cloudwatch_agent_extra.name
    redis_metrics_script     = file("${local.deploy_dir}/monitoring/redis-metrics.sh")
    monitoring_units = {
      for f in ["fenwira-redis-metrics.service", "fenwira-redis-metrics.timer"] :
      f => file("${local.deploy_dir}/systemd/${f}")
    }
    redis_conf = file("${local.deploy_dir}/redis/fenwira-redis.conf")
    units = {
      for f in ["fenwira-api.service", "fenwira-worker.service", "fenwira-web.service", "fenwira.target"] :
      f => file("${local.deploy_dir}/systemd/${f}")
    }
    nginx_snippets = {
      for f in ["fenwira-proxy.conf", "fenwira-security-headers.conf", "fenwira-tls.conf"] :
      f => file("${local.deploy_dir}/nginx/snippets/${f}")
    }
    nginx_upgrade_map  = file("${local.deploy_dir}/nginx/conf.d/fenwira-upgrade-map.conf")
    nginx_default_site = file("${local.deploy_dir}/nginx/fenwira-default.conf")
  }))
  user_data_replace_on_change = false

  tags        = { Name = "${local.name}-app" }
  volume_tags = null

  lifecycle {
    ignore_changes = [ami, user_data_base64]

    precondition {
      condition = anytrue([
        for r in data.aws_route_table.ec2.routes :
        r.cidr_block == "0.0.0.0/0" && r.gateway_id == data.aws_internet_gateway.this.internet_gateway_id
      ])
      error_message = "The EC2 subnet has no default route to the internet gateway; it is not public."
    }
  }

  depends_on = [aws_iam_role_policy.ec2_app, aws_iam_role_policy_attachment.ssm_core]
}
