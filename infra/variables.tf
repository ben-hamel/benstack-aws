variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo in owner/repo format (e.g. owner/repo)"
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

variable "hosted_zone_name" {
  description = "Route 53 hosted zone name for AWS subdomains (e.g. aws.example.com)"
  type        = string
}

variable "allowed_emails" {
  description = "Comma-separated list of emails allowed to sign in"
  type        = string
}

variable "better_auth_secret" {
  description = "Secret key for Better Auth"
  type        = string
  sensitive   = true
}

variable "better_auth_url" {
  description = "Public URL of the API"
  type        = string
}

variable "cors_origin" {
  description = "Allowed CORS origin (frontend URL)"
  type        = string
}

variable "api_mode" {
  description = "Which API backend to deploy: ecs or serverless"
  type        = string
  default     = "ecs"

  validation {
    condition     = contains(["ecs", "serverless"], var.api_mode)
    error_message = "api_mode must be 'ecs' or 'serverless'."
  }
}


