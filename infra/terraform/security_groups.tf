# Two dedicated groups; existing ZenteqK security groups are not reused or modified.

resource "aws_security_group" "ec2" {
  name        = "${local.name}-ec2"
  description = "Fenwira v2 app server: HTTP/HTTPS in only (no SSH; access via SSM Session Manager)"
  vpc_id      = data.aws_vpc.this.id
  tags        = { Name = "${local.name}-ec2" }
}

resource "aws_vpc_security_group_ingress_rule" "ec2_http" {
  security_group_id = aws_security_group.ec2.id
  description       = "HTTP (redirect to HTTPS, ACME HTTP-01)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "ec2_https" {
  security_group_id = aws_security_group.ec2.id
  description       = "HTTPS (app and API through nginx)"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# Outbound: Meta Graph API, S3, the SMTP provider (chosen later), SSM/CloudWatch endpoints, package mirrors, and
# PostgreSQL to RDS. There is no NAT gateway; the instance has a public address.
resource "aws_vpc_security_group_egress_rule" "ec2_all" {
  security_group_id = aws_security_group.ec2.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "Fenwira v2 RDS: PostgreSQL from the Fenwira app server only"
  vpc_id      = data.aws_vpc.this.id
  tags        = { Name = "${local.name}-rds" }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_ec2" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from the Fenwira app server security group"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.ec2.id
}
# No egress rules on the RDS group: the database initiates no connections.
