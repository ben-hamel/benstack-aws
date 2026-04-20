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
