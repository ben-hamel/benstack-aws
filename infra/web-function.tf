locals {
  # Keep the indexed state addresses used by the original cutover.
  web_api_count    = 1
  web_api_name     = "benstack-api-web"
  web_api_log_name = "/aws/lambda/web/${local.web_api_name}"
  web_api_parameters = [
    "neon-database-url", "better-auth-secret", "better-auth-url", "cors-origin",
    "allowed-emails", "s3-receipts-bucket", "anthropic-api-key",
  ]
}

data "archive_file" "web_api" {
  count       = local.web_api_count
  type        = "zip"
  output_path = "${path.root}/.terraform/benstack-web-api.zip"

  source {
    content  = file("${path.root}/../apps/server/dist/web-function/index.js")
    filename = "index.js"
  }
  source {
    content  = file("${path.root}/../apps/server/dist/web-function/package.json")
    filename = "package.json"
  }
}

resource "aws_s3_bucket" "web_api_artifacts" {
  count         = local.web_api_count
  bucket_prefix = "benstack-web-api-artifacts-"
}

resource "aws_s3_bucket_public_access_block" "web_api_artifacts" {
  count                   = local.web_api_count
  bucket                  = aws_s3_bucket.web_api_artifacts[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "web_api_artifacts" {
  count  = local.web_api_count
  bucket = aws_s3_bucket.web_api_artifacts[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "web_api_artifacts" {
  count  = local.web_api_count
  bucket = aws_s3_bucket.web_api_artifacts[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = ["s3:GetObject", "s3:GetObjectVersion"]
      Resource  = "${aws_s3_bucket.web_api_artifacts[0].arn}/web-api/*"
      Condition = {
        ArnLike      = { "aws:SourceArn" = "${aws_lambdaweb_function.api[0].arn}/revision/*" }
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
      }, {
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.web_api_artifacts[0].arn, "${aws_s3_bucket.web_api_artifacts[0].arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.web_api_artifacts]
}

resource "aws_s3_object" "web_api" {
  count                  = local.web_api_count
  bucket                 = aws_s3_bucket.web_api_artifacts[0].id
  key                    = "web-api/bundle.zip"
  source                 = data.archive_file.web_api[0].output_path
  source_hash            = data.archive_file.web_api[0].output_sha256
  server_side_encryption = "AES256"
  depends_on             = [aws_s3_bucket_versioning.web_api_artifacts]
}

resource "aws_cloudwatch_log_group" "web_api" {
  for_each          = toset([local.web_api_log_name, "${local.web_api_log_name}.local"])
  name              = each.value
  retention_in_days = 14
}

resource "aws_iam_role" "web_api" {
  count = local.web_api_count
  name  = "benstack-web-api-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "web_api" {
  count = local.web_api_count
  name  = "benstack-web-api-execution"
  role  = aws_iam_role.web_api[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ssm:GetParameters"
      Resource = [for key in local.web_api_parameters : "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/${key}"]
      }, {
      Effect   = "Allow"
      Action   = "s3:PutObject"
      Resource = "${aws_s3_bucket.receipts.arn}/uploads/*"
      }, {
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = [for group in aws_cloudwatch_log_group.web_api : "${group.arn}:*"]
    }]
  })
}

resource "aws_lambdaweb_function" "api" {
  count         = local.web_api_count
  function_name = local.web_api_name
}

resource "aws_lambdaweb_function_revision" "api" {
  count         = local.web_api_count
  function_name = aws_lambdaweb_function.api[0].function_name

  build_config {
    code_config {
      s3_object {
        bucket     = aws_s3_object.web_api[0].bucket
        key        = aws_s3_object.web_api[0].key
        version_id = aws_s3_object.web_api[0].version_id
      }
    }
    runtime_config {
      runtime = "nodejs24.x"
    }
  }

  service_config {
    execution_role_arn              = aws_iam_role.web_api[0].arn
    max_concurrency_per_environment = 4
    timeout_seconds                 = 60
    environment_variables = {
      NODE_ENV                = "production"
      WEB_FUNCTION_MODE       = "application"
      WEB_FUNCTION_CONFIG     = "ssm"
      WEB_FUNCTION_SSM_PREFIX = "/benstack/"
    }
  }

  lifecycle {
    create_before_destroy = true
  }
  depends_on = [aws_s3_bucket_policy.web_api_artifacts, aws_iam_role_policy.web_api]
}

resource "aws_lambdaweb_function_endpoint" "api" {
  count                = local.web_api_count
  function_name        = aws_lambdaweb_function.api[0].function_name
  endpoint_name        = "api"
  endpoint_type        = "HomeRegion"
  auth_type            = "IamAuth"
  auto_deployment_mode = "Disabled"

  revision_weight {
    revision_id = aws_lambdaweb_function_revision.api[0].revision_id
    weight      = 100
  }
  scaling_config {
    max_environments = 2
  }
  throttle_config {
    rate_limit = 100
  }
}

# CloudFront requires an issued us-east-1 certificate. Reuse the API certificate
# already in that region rather than creating a competing DNS validation record.
data "aws_acm_certificate" "web_api" {
  count    = local.web_api_count
  region   = "us-east-1"
  domain   = var.api_domain
  statuses = ["ISSUED"]
}

resource "aws_cloudfront_origin_access_control" "web_api" {
  count                             = local.web_api_count
  name                              = "benstack-web-api"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always-amz-auth"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web_api" {
  count   = local.web_api_count
  enabled = true
  aliases = [var.api_domain]

  origin {
    domain_name              = aws_lambdaweb_function_endpoint.api[0].domain_name
    origin_id                = "web-api"
    origin_access_control_id = aws_cloudfront_origin_access_control.web_api[0].id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id         = "web-api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewerExceptHostHeader
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.web_api[0].arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_lambdaweb_resource_policy" "web_api" {
  count        = local.web_api_count
  resource_arn = aws_lambdaweb_function.api[0].arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "lambda:InvokeWebFunctionEndpoint"
      Resource  = aws_lambdaweb_function_endpoint.api[0].arn
      Condition = { StringEquals = { "aws:SourceArn" = aws_cloudfront_distribution.web_api[0].arn } }
    }]
  })
}
