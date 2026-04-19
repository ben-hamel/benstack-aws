provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_subnet" "all" {
  for_each = toset(data.aws_subnets.default.ids)
  id       = each.value
}

locals {
  # ALB requires exactly one subnet per AZ
  subnets_by_az     = { for s in data.aws_subnet.all : s.availability_zone => s.id... }
  unique_subnet_ids = [for az, ids in local.subnets_by_az : ids[0]]
}

data "aws_subnet" "primary" {
  id = local.unique_subnet_ids[0]
}

# ── GitHub Actions OIDC ───────────────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "benstack-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions" {
  name = "benstack-github-actions"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECR"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = "*"
      },
      {
        Sid    = "ECS"
        Effect = "Allow"
        Action = [
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:RunTask",
          "ecs:DescribeTasks",
          "ecs:StopTask"
        ]
        Resource = "*"
      },
      {
        Sid    = "EC2Describe"
        Effect = "Allow"
        Action = ["ec2:DescribeSecurityGroups"]
        Resource = "*"
      },
      {
        Sid    = "PassRole"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_execution.arn,
          aws_iam_role.ecs_task.arn
        ]
      },
      {
        Sid    = "S3Frontend"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.frontend.arn,
          "${aws_s3_bucket.frontend.arn}/*"
        ]
      },
      {
        Sid      = "CloudFrontInvalidate"
        Effect   = "Allow"
        Action   = "cloudfront:CreateInvalidation"
        Resource = aws_cloudfront_distribution.frontend.arn
      },
      {
        Sid    = "LambdaDeploy"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration"
        ]
        Resource = aws_lambda_function.receipt_processor.arn
      }
    ]
  })
}

# ── ECR ───────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "api" {
  name                 = "benstack-api"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# ── IAM ───────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "benstack-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow execution role to read SSM parameters for env vars
resource "aws_iam_role_policy" "ecs_execution_ssm" {
  name = "benstack-ecs-ssm"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters", "ssm:GetParameter"]
      Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/*"
    }]
  })
}

# ── ECS Task Role (for ECS Exec) ─────────────────────────────────────────────

resource "aws_iam_role" "ecs_task" {
  name = "benstack-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_exec_command" {
  name = "benstack-ecs-exec-command"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ]
        Resource = "*"
      },
      {
        Sid    = "S3ReceiptUpload"
        Effect = "Allow"
        Action = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.receipts.arn}/uploads/*"
      }
    ]
  })
}

# ── ECS ───────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/benstack-api"
  retention_in_days = 7
}

resource "aws_ecs_cluster" "benstack" {
  name = "benstack"
}

resource "aws_ecs_task_definition" "api" {
  family                   = "benstack-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = "${aws_ecr_repository.api.repository_url}:latest"
    essential = true

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/database-url"
      },
      {
        name      = "BETTER_AUTH_SECRET"
        valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/better-auth-secret"
      },
      {
        name      = "BETTER_AUTH_URL"
        valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/better-auth-url"
      },
      {
        name      = "CORS_ORIGIN"
        valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/cors-origin"
      },
      {
        name      = "ALLOWED_EMAILS"
        valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/allowed-emails"
      },
      {
        name      = "S3_RECEIPTS_BUCKET"
        valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/s3-receipts-bucket"
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

# Security group for ECS tasks
resource "aws_security_group" "ecs_tasks" {
  name        = "benstack-ecs-tasks"
  description = "Allow inbound from ALB on port 3000"
  vpc_id      = data.aws_subnet.primary.vpc_id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Allow ECS tasks to reach RDS
resource "aws_security_group_rule" "ecs_to_rds" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_tasks.id
  security_group_id        = aws_security_group.rds.id
}

resource "aws_ecs_service" "api" {
  name                   = "benstack-api"
  cluster                = aws_ecs_cluster.benstack.id
  task_definition        = aws_ecs_task_definition.api.arn
  desired_count          = 1
  launch_type            = "FARGATE"
  enable_execute_command = true

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.https]

  lifecycle {
    ignore_changes = [task_definition]
  }
}

# ── ALB ───────────────────────────────────────────────────────────────────────

# ALB security group
resource "aws_security_group" "alb" {
  name        = "benstack-alb"
  description = "Allow HTTP and HTTPS inbound to ALB"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ACM certificate
resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ALB
resource "aws_lb" "benstack" {
  name               = "benstack"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.unique_subnet_ids
}

# Target group — ip type required for Fargate
resource "aws_lb_target_group" "api" {
  name                 = "benstack-api-ecs"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_lb.benstack.vpc_id
  deregistration_delay = 60

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  lifecycle {
    create_before_destroy = true
  }
}

# HTTPS listener
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.benstack.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# HTTP listener - redirect to HTTPS
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.benstack.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ── Frontend (S3 + CloudFront) ────────────────────────────────────────────────

resource "aws_s3_bucket" "frontend" {
  bucket = "benstack-frontend"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "benstack-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}

# ACM cert for frontend domain (us-east-1 = CloudFront requirement, already our region)
resource "aws_acm_certificate" "frontend" {
  domain_name       = var.frontend_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "frontend" {
  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for record in aws_route53_record.frontend_cert_validation : record.fqdn]
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = [var.frontend_domain]

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized (AWS managed)
  }

  # SPA routing: send all 404s back to index.html so React Router handles them
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.frontend.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ── DB Migrations ─────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/benstack-migrate"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "benstack-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = "${aws_ecr_repository.api.repository_url}:migrate-latest"
    essential = true

    secrets = [{
      name      = "DATABASE_URL"
      valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/database-url"
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.migrate.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

# ── Seed ──────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "seed" {
  name              = "/ecs/benstack-seed"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "seed" {
  family                   = "benstack-seed"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([{
    name      = "seed"
    image     = "${aws_ecr_repository.api.repository_url}:seed-latest"
    essential = true

    secrets = [{
      name      = "DATABASE_URL"
      valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/benstack/database-url"
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.seed.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

# ── S3 Receipts Bucket ────────────────────────────────────────────────────────

resource "aws_s3_bucket" "receipts" {
  bucket = "benstack-receipts"
}

resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"]
    allowed_origins = ["https://${var.frontend_domain}"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# ── SQS ───────────────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "receipt_processing_dlq" {
  name                      = "benstack-receipt-processing-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "receipt_processing" {
  name = "benstack-receipt-processing"

  # Must be >= Lambda timeout so a slow execution doesn't cause duplicate processing
  visibility_timeout_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.receipt_processing_dlq.arn
    maxReceiveCount     = 3
  })
}

# Allow S3 to send messages to the queue
resource "aws_sqs_queue_policy" "receipt_processing" {
  queue_url = aws_sqs_queue.receipt_processing.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.receipt_processing.arn
      Condition = {
        ArnEquals = {
          "aws:SourceArn" = aws_s3_bucket.receipts.arn
        }
      }
    }]
  })
}

# Wire S3 to fire a notification into SQS on every upload
resource "aws_s3_bucket_notification" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  queue {
    queue_arn     = aws_sqs_queue.receipt_processing.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "uploads/"
  }

  depends_on = [aws_sqs_queue_policy.receipt_processing]
}

# ── Lambda ────────────────────────────────────────────────────────────────────


# Build the zip from the pre-bundled JS file (run `bun run build:lambda` first)
data "archive_file" "lambda_receipt_processor" {
  type        = "zip"
  source_file = "${path.module}/../apps/receipt-processor/dist/index.js"
  output_path = "${path.module}/../apps/receipt-processor/dist/function.zip"
}

resource "aws_cloudwatch_log_group" "lambda_receipt_processor" {
  name              = "/aws/lambda/benstack-receipt-processor"
  retention_in_days = 7
}

resource "aws_iam_role" "lambda_receipt_processor" {
  name = "benstack-lambda-receipt-processor"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Allows Lambda to create/manage ENIs so it can join the VPC
resource "aws_iam_role_policy_attachment" "lambda_vpc_access" {
  role       = aws_iam_role.lambda_receipt_processor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda_receipt_processor" {
  name = "benstack-lambda-receipt-processor"
  role = aws_iam_role.lambda_receipt_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3ReadReceipts"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.receipts.arn}/uploads/*"
      },
      {
        Sid    = "SQSConsume"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.receipt_processing.arn
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.lambda_receipt_processor.arn}:*"
      }
    ]
  })
}

resource "aws_security_group" "lambda_receipt_processor" {
  name        = "benstack-lambda-receipt-processor"
  description = "Lambda receipt processor - egress to RDS only"
  vpc_id      = data.aws_subnet.primary.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Allow Lambda to reach RDS (mirrors the existing ecs_to_rds rule)
resource "aws_security_group_rule" "lambda_to_rds" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.lambda_receipt_processor.id
  security_group_id        = aws_security_group.rds.id
}

resource "aws_lambda_function" "receipt_processor" {
  filename         = data.archive_file.lambda_receipt_processor.output_path
  source_code_hash = data.archive_file.lambda_receipt_processor.output_base64sha256
  function_name    = "benstack-receipt-processor"
  role             = aws_iam_role.lambda_receipt_processor.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 300
  memory_size      = 512

  vpc_config {
    subnet_ids         = data.aws_subnets.default.ids
    security_group_ids = [aws_security_group.lambda_receipt_processor.id]
  }

  environment {
    variables = {
      DATABASE_URL = var.database_url
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_vpc_access,
    aws_cloudwatch_log_group.lambda_receipt_processor,
  ]
}

# Wire SQS → Lambda (batch_size=1 so each upload is one Lambda invocation)
resource "aws_lambda_event_source_mapping" "receipt_sqs" {
  event_source_arn = aws_sqs_queue.receipt_processing.arn
  function_name    = aws_lambda_function.receipt_processor.arn
  batch_size       = 1
}

# ── S3 Gateway VPC Endpoint (free — lets Lambda reach S3 without internet) ───

data "aws_route_tables" "vpc" {
  vpc_id = data.aws_subnet.primary.vpc_id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id       = data.aws_subnet.primary.vpc_id
  service_name = "com.amazonaws.${var.aws_region}.s3"

  route_table_ids = data.aws_route_tables.vpc.ids
}

# ── Route 53 ─────────────────────────────────────────────────────────────────

resource "aws_route53_zone" "aws" {
  name = var.hosted_zone_name
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.aws.zone_id
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

resource "aws_route53_record" "frontend_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.frontend.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.aws.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_route53_record" "frontend" {
  zone_id = aws_route53_zone.aws.zone_id
  name    = var.frontend_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.aws.zone_id
  name    = var.api_domain
  type    = "A"

  alias {
    name                   = aws_lb.benstack.dns_name
    zone_id                = aws_lb.benstack.zone_id
    evaluate_target_health = true
  }
}

# ── SSM ───────────────────────────────────────────────────────────────────────

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
  value = var.database_url
}

resource "aws_ssm_parameter" "s3_receipts_bucket" {
  name  = "/benstack/s3-receipts-bucket"
  type  = "String"
  value = aws_s3_bucket.receipts.id
}

# ── RDS ───────────────────────────────────────────────────────────────────────

resource "aws_security_group" "rds" {
  name        = "benstack-rds"
  description = "Allow inbound Postgres from ECS and Lambda"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "benstack" {
  identifier        = "benstack"
  instance_class    = "db.t4g.micro"
  engine            = "postgres"
  engine_version    = "17.6"
  allocated_storage = 20
  storage_type      = "gp2"
  storage_encrypted = true

  username = "benstack"
  password = "ignored-managed-outside-terraform"

  db_subnet_group_name   = "rds-ec2-db-subnet-group-1"
  vpc_security_group_ids = [aws_security_group.rds.id]

  publicly_accessible          = false
  multi_az                     = false
  skip_final_snapshot          = true
  copy_tags_to_snapshot        = true
  max_allocated_storage        = 1000
  performance_insights_enabled = true

  lifecycle {
    ignore_changes = [password]
  }
}
