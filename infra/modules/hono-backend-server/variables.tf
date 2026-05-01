variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "aws_region" {
  type = string
}

variable "aws_account_id" {
  type = string
}

variable "api_domain" {
  type = string
}

variable "hosted_zone_id" {
  type = string
}

variable "vpc_endpoints_sg_id" {
  type = string
}

variable "rds_sg_id" {
  type = string
}

