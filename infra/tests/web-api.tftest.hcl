mock_provider "aws" {
  override_during = plan
  mock_resource "aws_acm_certificate_validation" {
    defaults = { certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-4000-8000-000000000001" }
  }
  mock_resource "aws_acm_certificate" {
    defaults = { arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-4000-8000-000000000001" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_data "aws_acm_certificate" {
    defaults = { arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-4000-8000-000000000002" }
  }
}

override_resource {
  target          = aws_acm_certificate.frontend
  override_during = plan
  values = {
    arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-4000-8000-000000000001"
    domain_validation_options = [{
      domain_name           = "app.aws.example.com"
      resource_record_name  = "_mock.app.aws.example.com"
      resource_record_type  = "CNAME"
      resource_record_value = "_mock.acm-validations.aws"
    }]
  }
}

override_resource {
  target          = module.hono_serverless_api[0].aws_acm_certificate.api
  override_during = plan
  values = {
    arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-4000-8000-000000000002"
    domain_validation_options = [{
      domain_name           = "api.aws.example.com"
      resource_record_name  = "_mock.api.aws.example.com"
      resource_record_type  = "CNAME"
      resource_record_value = "_mock.acm-validations.aws"
    }]
  }
}
mock_provider "random" {}
mock_provider "archive" {}

variables {
  aws_region         = "us-east-1"
  github_repo        = "example/benstack"
  api_domain         = "api.aws.example.com"
  frontend_domain    = "app.aws.example.com"
  hosted_zone_name   = "aws.example.com"
  allowed_emails     = "dev@example.com"
  better_auth_secret = "mock-only-not-a-secret"
  better_auth_url    = "https://api.aws.example.com"
  cors_origin        = "https://app.aws.example.com"
}

run "keep_current_api_by_default" {
  command = plan

  assert {
    condition     = length(aws_lambdaweb_function.api) == 0 && aws_route53_record.api.alias[0].evaluate_target_health
    error_message = "A default plan must keep API Gateway routing and not create a Web Function."
  }
}

run "cutover_requires_deployment" {
  command = plan

  variables {
    route_api_to_web_function = true
  }

  expect_failures = [aws_route53_record.api]
}

run "cutover_keeps_gateway_for_rollback" {
  command = plan

  variables {
    deploy_web_api            = true
    route_api_to_web_function = true
  }

  assert {
    condition     = length(module.hono_serverless_api) == 1 && !aws_route53_record.api.alias[0].evaluate_target_health
    error_message = "Cutover must keep the old API and use a CloudFront-compatible DNS alias."
  }

  assert {
    condition = (
      aws_lambdaweb_function_endpoint.api[0].auth_type == "IamAuth" &&
      aws_cloudfront_origin_access_control.web_api[0].signing_behavior == "always-amz-auth" &&
      aws_cloudfront_distribution.web_api[0].default_cache_behavior[0].cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    )
    error_message = "The API origin must require signed CloudFront requests and the API responses must not be cached."
  }
}
