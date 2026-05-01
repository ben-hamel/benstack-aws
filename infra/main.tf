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

module "hono_backend_server" {
  source = "./modules/hono-backend-server"

  vpc_id                 = aws_vpc.benstack.id
  public_subnet_ids      = local.public_subnet_ids
  aws_region             = var.aws_region
  aws_account_id         = data.aws_caller_identity.current.account_id
  api_domain             = var.api_domain
  hosted_zone_id         = aws_route53_zone.aws.zone_id
  vpc_endpoints_sg_id    = aws_security_group.vpc_endpoints.id
  rds_sg_id              = aws_security_group.rds.id
}
