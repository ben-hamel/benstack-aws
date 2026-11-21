resource "aws_route53_zone" "aws" {
  name = var.hosted_zone_name
}

resource "aws_route53_record" "frontend_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.frontend.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.aws.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.aws.zone_id
  name    = var.api_domain
  type    = "A"

  alias {
    name                   = var.route_api_to_web_function && var.deploy_web_api ? aws_cloudfront_distribution.web_api[0].domain_name : module.hono_serverless_api[0].api_gateway_domain_name
    zone_id                = var.route_api_to_web_function && var.deploy_web_api ? aws_cloudfront_distribution.web_api[0].hosted_zone_id : module.hono_serverless_api[0].api_gateway_hosted_zone_id
    evaluate_target_health = !var.route_api_to_web_function
  }

  lifecycle {
    precondition {
      condition     = !var.route_api_to_web_function || var.deploy_web_api
      error_message = "Set deploy_web_api=true before routing the API to the Web Function."
    }
  }

  depends_on = [aws_lambdaweb_resource_policy.web_api]
}

resource "aws_route53_record" "frontend" {
  zone_id = aws_route53_zone.aws.zone_id
  name    = var.frontend_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}
