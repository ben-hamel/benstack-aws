provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      project     = "benstack"
      environment = "production"
      managed_by  = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

# Retire management, not the live objects. See docs/lambda-cutover.md.
removed {
  from = module.hono_backend_server

  lifecycle {
    destroy = false
  }
}

module "hono_serverless_api" {
  # This module now retains only the API certificate and its DNS validation.
  # Keep its existing state address to avoid replacing the certificate.
  count  = 1
  source = "./modules/hono-serverless-api"

  api_domain     = var.api_domain
  hosted_zone_id = aws_route53_zone.aws.zone_id
}
