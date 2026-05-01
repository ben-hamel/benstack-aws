resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_subnet_group" "benstack" {
  name       = "benstack"
  subnet_ids = local.public_subnet_ids
}

resource "aws_db_instance" "benstack" {
  identifier        = "benstack"
  instance_class    = "db.t4g.micro"
  engine            = "postgres"
  engine_version    = "17.6"
  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  username = "benstack"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.benstack.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  publicly_accessible          = false
  multi_az                     = false
  skip_final_snapshot          = true # production: set to false and add final_snapshot_identifier
  copy_tags_to_snapshot        = true
  max_allocated_storage        = 1000
  performance_insights_enabled = true
}
