# No new VPC, subnets, route tables or NAT gateway. Fenwira v2 reuses the existing VPC; the only
# networking resources created are a dedicated DB subnet group (over the existing private subnets)
# and an Elastic IP for the instance.

resource "aws_db_subnet_group" "this" {
  name        = "${local.name}-db"
  description = "Fenwira v2 RDS: existing private subnets (local route only)"
  subnet_ids  = data.aws_subnets.private.ids

  lifecycle {
    precondition {
      condition     = length(data.aws_subnets.private.ids) >= 2
      error_message = "Need private subnets in at least two AZs for an RDS subnet group."
    }
    precondition {
      # Private = no default route at all (no internet gateway, no NAT).
      condition = alltrue([
        for rt in data.aws_route_table.private :
        !anytrue([for r in rt.routes : r.cidr_block == "0.0.0.0/0" || r.ipv6_cidr_block == "::/0"])
      ])
      error_message = "A subnet matched as private has a default route; refusing to place RDS in it."
    }
  }
}

resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "${local.name}-ec2" }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
