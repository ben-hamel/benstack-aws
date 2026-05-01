data "archive_file" "lambda_receipt_processor" {
  type        = "zip"
  source_file = "${path.module}/../apps/receipt-processor/dist/index.js"
  output_path = "${path.module}/../apps/receipt-processor/dist/function.zip"
}

# ── ECS receipt processor (always deployed, inside VPC, uses RDS) ─────────────

resource "aws_cloudwatch_log_group" "lambda_receipt_processor" {
  name              = "/aws/lambda/benstack-receipt-processor"
  retention_in_days = 7
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

  layers = ["arn:aws:lambda:${var.aws_region}:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:12"]

  vpc_config {
    subnet_ids         = local.public_subnet_ids
    security_group_ids = [aws_security_group.lambda_receipt_processor.id]
  }

  environment {
    variables = {
      SSM_PARAMETER_PATH = "/benstack/database-url"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_vpc_access,
    aws_cloudwatch_log_group.lambda_receipt_processor,
  ]
}

# ── Serverless receipt processor (always deployed, outside VPC, uses Neon) ────

resource "aws_cloudwatch_log_group" "receipt_processor_serverless" {
  name              = "/aws/lambda/benstack-receipt-processor-serverless"
  retention_in_days = 7
}

resource "aws_lambda_function" "receipt_processor_serverless" {
  filename         = data.archive_file.lambda_receipt_processor.output_path
  source_code_hash = data.archive_file.lambda_receipt_processor.output_base64sha256
  function_name    = "benstack-receipt-processor-serverless"
  role             = aws_iam_role.lambda_receipt_processor.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 300
  memory_size      = 512

  layers = ["arn:aws:lambda:${var.aws_region}:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:12"]

  environment {
    variables = {
      SSM_PARAMETER_PATH = "/benstack/neon-database-url"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.receipt_processor_serverless,
  ]
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

resource "aws_lambda_event_source_mapping" "receipt_sqs" {
  event_source_arn = aws_sqs_queue.receipt_processing.arn
  function_name    = var.api_mode == "serverless" ? aws_lambda_function.receipt_processor_serverless.arn : aws_lambda_function.receipt_processor.arn
  batch_size       = 1
}
