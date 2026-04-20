resource "aws_ssm_parameter" "allowed_emails" {
  name  = "/benstack/allowed-emails"
  type  = "SecureString"
  value = var.allowed_emails
}

resource "aws_ssm_parameter" "better_auth_secret" {
  name  = "/benstack/better-auth-secret"
  type  = "SecureString"
  value = var.better_auth_secret
}

resource "aws_ssm_parameter" "better_auth_url" {
  name  = "/benstack/better-auth-url"
  type  = "String"
  value = var.better_auth_url
}

resource "aws_ssm_parameter" "cors_origin" {
  name  = "/benstack/cors-origin"
  type  = "String"
  value = var.cors_origin
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/benstack/database-url"
  type  = "SecureString"
  value = "postgresql://benstack:${random_password.db.result}@${aws_db_instance.benstack.endpoint}/postgres?sslmode=require&uselibpqcompat=true"
}

resource "aws_ssm_parameter" "s3_receipts_bucket" {
  name  = "/benstack/s3-receipts-bucket"
  type  = "String"
  value = aws_s3_bucket.receipts.id
}
