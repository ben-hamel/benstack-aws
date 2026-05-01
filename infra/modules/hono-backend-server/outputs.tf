output "ecs_execution_role_arn" {
  value = aws_iam_role.ecs_execution.arn
}

output "ecs_task_role_arn" {
  value = aws_iam_role.ecs_task.arn
}

output "database_url_ssm_arn" {
  value = aws_ssm_parameter.database_url.arn
}

output "alb_dns_name" {
  value = aws_lb.benstack.dns_name
}

output "alb_zone_id" {
  value = aws_lb.benstack.zone_id
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.benstack.name
}

output "ecs_tasks_sg_id" {
  value = aws_security_group.ecs_tasks.id
}
