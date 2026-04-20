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
  # Only attach the internet-facing ALB and public-IP ECS tasks to public subnets.
  public_subnets_by_az = {
    for s in data.aws_subnet.all : s.availability_zone => s.id...
    if s.map_public_ip_on_launch
  }
  private_subnets_by_az = {
    for s in data.aws_subnet.all : s.availability_zone => s.id...
    if !s.map_public_ip_on_launch
  }

  public_subnet_ids  = [for az in sort(keys(local.public_subnets_by_az)) : local.public_subnets_by_az[az][0]]
  private_subnet_ids = [for az in sort(keys(local.private_subnets_by_az)) : local.private_subnets_by_az[az][0]]
}

data "aws_subnet" "primary" {
  id = local.public_subnet_ids[0]
}

data "aws_prefix_list" "s3" {
  name = "com.amazonaws.${var.aws_region}.s3"
}

# ── Security Groups ───────────────────────────────────────────────────────────

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

resource "aws_security_group" "lambda_receipt_processor" {
  name        = "benstack-lambda-receipt-processor"
  description = "Lambda receipt processor"
  vpc_id      = data.aws_subnet.primary.vpc_id

  lifecycle {
    ignore_changes = [egress, ingress]
  }
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "benstack-vpc-endpoints"
  description = "Allow HTTPS from Lambda to VPC interface endpoints"
  vpc_id      = data.aws_subnet.primary.vpc_id
}

# ── Security Group Rules ──────────────────────────────────────────────────────

resource "aws_security_group_rule" "ecs_to_rds" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_tasks.id
  security_group_id        = aws_security_group.rds.id
}

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

data "aws_route_tables" "vpc" {
  vpc_id = data.aws_subnet.primary.vpc_id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id          = data.aws_subnet.primary.vpc_id
  service_name    = "com.amazonaws.${var.aws_region}.s3"
  route_table_ids = data.aws_route_tables.vpc.ids
}

resource "aws_vpc_endpoint" "ssm" {
  vpc_id              = data.aws_subnet.primary.vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.ssm"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [data.aws_subnet.primary.id]
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true
}
