# Created only when manage_dns = true. Since the 2026-10-10 cutover (owner-approved) both names point at
# this server: app.fenwira.zenteqk.com (web; its v1 CloudFront A/AAAA records were removed) and
# api.fenwira.zenteqk.com (API). The records were switched atomically with the AWS CLI and are adopted
# into this state by the import blocks below. fenwira.zenteqk.com (landing, state
# internal/fenwira-landing/prod) is never touched. allow_overwrite = false makes Terraform fail rather
# than take over any other existing record.

import {
  to = aws_route53_record.app[0]
  id = "Z015108329JYWELDKHFGM_app.fenwira.zenteqk.com_A"
}

import {
  to = aws_route53_record.api[0]
  id = "Z015108329JYWELDKHFGM_api.fenwira.zenteqk.com_A"
}

resource "aws_route53_record" "app" {
  count           = var.manage_dns ? 1 : 0
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = var.app_domain
  type            = "A"
  ttl             = var.dns_ttl
  records         = [aws_eip.app.public_ip]
  allow_overwrite = false
}

resource "aws_route53_record" "api" {
  count           = var.manage_dns ? 1 : 0
  zone_id         = data.aws_route53_zone.this.zone_id
  name            = var.api_domain
  type            = "A"
  ttl             = var.dns_ttl
  records         = [aws_eip.app.public_ip]
  allow_overwrite = false
}
