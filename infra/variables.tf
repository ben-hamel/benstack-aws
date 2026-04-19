variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "github_repo" {
  description = "GitHub repo in owner/repo format"
  type        = string
  default     = "ben-hamel/benstack-aws"
}

variable "vpc_subnet_ids" {
  description = "List of VPC subnet IDs for the ALB, ECS tasks, and Lambda"
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "ID of the security group attached to the RDS instance"
  type        = string
}

variable "api_domain" {
  description = "Custom domain for the API (e.g. api.example.com)"
  type        = string
}

variable "frontend_domain" {
  description = "Custom domain for the frontend (e.g. app.example.com)"
  type        = string
}
