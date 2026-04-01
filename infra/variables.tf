variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "github_repo" {
  description = "GitHub repo in owner/repo format (e.g. benehamel/benstack-aws)"
  type        = string
}
