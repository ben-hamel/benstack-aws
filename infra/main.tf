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
  # Keep the existing production module address: module.hono_serverless_api[0].
  count  = 1
  source = "./modules/hono-serverless-api"

  aws_region     = var.aws_region
  aws_account_id = data.aws_caller_identity.current.account_id
  api_domain     = var.api_domain
  hosted_zone_id = aws_route53_zone.aws.zone_id
}
