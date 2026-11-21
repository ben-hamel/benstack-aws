# Legacy infrastructure retention

For current HTTP API releases, see the [Web Function runbook](web-function-cutover.md). This document is only an inventory and retirement checklist for the earlier ECS/RDS migration. It is not a live inventory and does not authorize deletion.

Terraform's `removed` blocks with `destroy = false` can detach the old backend module and SSM interface endpoint from state without deleting them. Detached resources can remain live and billable; reverting Git does not restore Terraform management. Before retiring them, verify their resource IDs and owners and protect a state recovery point.

The historical addresses below were under `module.hono_backend_server[0]`. The old SSM interface endpoint was at `aws_vpc_endpoint.ssm[0]`.

| Area | Addresses relative to the old module |
| --- | --- |
| Database and config | `random_password.db`, `aws_db_subnet_group.benstack`, `aws_db_instance.benstack`, `aws_ssm_parameter.database_url` |
| Container deployment | `aws_ecr_repository.api`, `aws_ecs_cluster.benstack`, `aws_ecs_service.api`, `aws_ecs_task_definition.api`, `aws_ecs_task_definition.migrate`, `aws_ecs_task_definition.seed` |
| Task IAM | `aws_iam_role.ecs_execution`, `aws_iam_role_policy_attachment.ecs_execution`, `aws_iam_role_policy.ecs_execution_ssm`, `aws_iam_role.ecs_task`, `aws_iam_role_policy.ecs_task_exec_command` |
| Network | `aws_security_group.alb`, `aws_security_group.ecs_tasks`, `aws_security_group_rule.ecs_to_rds`, `aws_security_group_rule.vpc_endpoints_from_ecs` |
| TLS and load balancing | `aws_acm_certificate.api`, `aws_route53_record.api_cert_validation` (each instance), `aws_acm_certificate_validation.api`, `aws_lb.benstack`, `aws_lb_target_group.api`, `aws_lb_listener.https`, `aws_lb_listener.http` |
| Logs | `aws_cloudwatch_log_group.api`, `aws_cloudwatch_log_group.migrate`, `aws_cloudwatch_log_group.seed` |

## Before retiring retained resources

- Verify that the receipt queue has one active consumer: the Neon-backed receipt processor. Check for other consumers or dependencies before removing the retained RDS processor, IAM, logs, or networking.
- Confirm the old container service and load balancer serve no remaining traffic before retirement. Inventory deployments, IAM dependencies, registry images, and retained logs.
- Keep RDS and its configuration until backup, restore, and data retention are verified. The original RDS definition skipped the final snapshot; do not reuse that deletion behavior.
- Preserve shared resources, including the API certificate and renewal CNAMEs, DNS zone, frontend, receipt bucket, SQS queue and DLQ, Terraform state, and active SSM parameters.
