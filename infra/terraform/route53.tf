# Created only when manage_dns = true. v2 testing hostnames (approved): v2.fenwira.zenteqk.com (web)
# and api.fenwira.zenteqk.com (API); both are new records. app.fenwira.zenteqk.com (v1 demo, state
# internal/fenwira/prod) and fenwira.zenteqk.com (landing, state internal/fenwira-landing/prod) are
# never touched. allow_overwrite = false makes Terraform fail rather than take over an existing record.

resource "aws_route53_record" "app" {
  count           = var.manage_dns ? 1 : 0
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = var.app_domain
  type            = "A"
  ttl             = 300
  records         = [aws_eip.app.public_ip]
  allow_overwrite = false
}

resource "aws_route53_record" "api" {
  count           = var.manage_dns ? 1 : 0
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = var.api_domain
  type            = "A"
  ttl             = 300
  records         = [aws_eip.app.public_ip]
  allow_overwrite = false
}
