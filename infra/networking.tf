locals {
  public_subnet_ids = [for az in sort(keys(aws_subnet.public)) : aws_subnet.public[az].id]
}

data "aws_prefix_list" "s3" {
  name = "com.amazonaws.${var.aws_region}.s3"
}

# ── Security Groups ───────────────────────────────────────────────────────────

resource "aws_security_group" "rds" {
  name        = "benstack-rds"
  description = "Allow inbound Postgres from ECS and Lambda"
  vpc_id      = aws_vpc.benstack.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "lambda_receipt_processor" {
  name        = "benstack-lambda-receipt-processor"
  description = "Lambda receipt processor"
  vpc_id      = aws_vpc.benstack.id

  lifecycle {
    ignore_changes = [egress, ingress]
  }
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "benstack-vpc-endpoints"
  description = "Allow HTTPS from Lambda to VPC interface endpoints"
  vpc_id      = aws_vpc.benstack.id
}

# ── Security Group Rules ──────────────────────────────────────────────────────

resource "aws_security_group_rule" "lambda_to_rds" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.lambda_receipt_processor.id
  security_group_id        = aws_security_group.rds.id
}

resource "aws_security_group_rule" "lambda_to_s3" {
  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  prefix_list_ids   = [data.aws_prefix_list.s3.id]
  security_group_id = aws_security_group.lambda_receipt_processor.id
  description       = "HTTPS to S3 via gateway endpoint"
}

resource "aws_security_group_rule" "lambda_to_vpc_endpoints" {
  type                     = "egress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.vpc_endpoints.id
  security_group_id        = aws_security_group.lambda_receipt_processor.id
}

resource "aws_security_group_rule" "vpc_endpoints_from_lambda" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.lambda_receipt_processor.id
  security_group_id        = aws_security_group.vpc_endpoints.id
}

# ── VPC Endpoints ─────────────────────────────────────────────────────────────

resource "aws_vpc_endpoint" "s3" {
  vpc_id          = aws_vpc.benstack.id
  service_name    = "com.amazonaws.${var.aws_region}.s3"
  route_table_ids = [aws_route_table.public.id]
}

resource "aws_vpc_endpoint" "ssm" {
  count               = var.api_mode != "serverless" ? 1 : 0
  vpc_id              = aws_vpc.benstack.id
  service_name        = "com.amazonaws.${var.aws_region}.ssm"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [local.public_subnet_ids[0]]
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true
}
