# Existing ZenteqK resources: read only, never managed by this configuration.

data "aws_vpc" "this" {
  id = var.vpc_id
}

# Public subnet for the instance: the VPC's default subnet in the chosen AZ. Its public routing is
# verified by a precondition in ec2.tf (0.0.0.0/0 → internet gateway), not assumed from its name.
data "aws_subnet" "ec2" {
  vpc_id            = data.aws_vpc.this.id
  availability_zone = var.availability_zone
  default_for_az    = true
}

# Effective route table, as AWS resolves it: the explicit association if any, else the VPC's main
# route table (default subnets are associated implicitly).
data "aws_route_tables" "ec2_explicit" {
  vpc_id = data.aws_vpc.this.id
  filter {
    name   = "association.subnet-id"
    values = [data.aws_subnet.ec2.id]
  }
}

data "aws_route_table" "main" {
  vpc_id = data.aws_vpc.this.id
  filter {
    name   = "association.main"
    values = ["true"]
  }
}

data "aws_route_table" "ec2" {
  route_table_id = length(data.aws_route_tables.ec2_explicit.ids) > 0 ? data.aws_route_tables.ec2_explicit.ids[0] : data.aws_route_table.main.id
}

# Existing private subnets (one per AZ). Their routing (no internet route) is verified by a
# precondition in networking.tf.
data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.this.id]
  }
  filter {
    name   = "tag:Name"
    values = [var.private_subnet_name_pattern]
  }
}

data "aws_route_table" "private" {
  for_each  = toset(data.aws_subnets.private.ids)
  subnet_id = each.value
}

data "aws_internet_gateway" "this" {
  filter {
    name   = "attachment.vpc-id"
    values = [data.aws_vpc.this.id]
  }
}

# Canonical's current Ubuntu 24.04 LTS amd64 gp3 AMI (published by Canonical in SSM).
data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# AWS-managed key used for SSM SecureString parameters (no customer-managed keys are created).
data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

# Existing zenteqk.com zone (read only). Used to scope the certbot DNS-01 permission and, only
# after an approved cutover, for the app/api records.
data "aws_route53_zone" "this" {
  name         = var.route53_zone_name
  private_zone = false
}

# Existing fenwira.com zone (read only). Never created here: the domain's NS already delegate to it.
data "aws_route53_zone" "primary" {
  name         = var.primary_zone_name
  private_zone = false
}
