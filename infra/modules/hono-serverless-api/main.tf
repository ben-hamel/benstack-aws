# ── IAM ───────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_api" {
  name = "benstack-lambda-api"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_api_basic" {
  role       = aws_iam_role.lambda_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_api_permissions" {
  name = "benstack-lambda-api-permissions"
  role = aws_iam_role.lambda_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter/benstack/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "arn:aws:s3:::benstack-receipts/uploads/*"
      }
    ]
  })
}

# ── Lambda ────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda_api" {
  name              = "/aws/lambda/benstack-api"
  retention_in_days = 7
}

data "archive_file" "lambda_api" {
  type        = "zip"
  source_file = "${path.module}/../../../apps/server/dist/lambda/index.mjs"
  output_path = "${path.module}/../../../apps/server/dist/lambda/function.zip"
}

resource "aws_lambda_function" "api" {
  filename         = data.archive_file.lambda_api.output_path
  source_code_hash = data.archive_file.lambda_api.output_base64sha256
  function_name    = "benstack-api"
  role             = aws_iam_role.lambda_api.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 512

  # AWS Parameters and Secrets Lambda Extension — caches SSM values in-process
  layers = ["arn:aws:lambda:${var.aws_region}:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:12"]

  environment {
    variables = {
      NODE_ENV = "production"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_api_basic,
    aws_cloudwatch_log_group.lambda_api,
  ]
}

# ── API Gateway ───────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "api" {
  name          = "benstack-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "api" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ── ACM + Custom Domain ───────────────────────────────────────────────────────

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.api_cert_validation : record.fqdn]
}

resource "aws_apigatewayv2_domain_name" "api" {
  domain_name = var.api_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.api.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "api" {
  api_id      = aws_apigatewayv2_api.api.id
  domain_name = aws_apigatewayv2_domain_name.api.id
  stage       = aws_apigatewayv2_stage.api.id
}
