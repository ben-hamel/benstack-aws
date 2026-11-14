# Database Changes
- This project uses Drizzle `db:push` for schema changes in dev and production.
  Do not switch to a migration-based workflow without explicit approval.
- Verify the target database/Neon branch and review proposed SQL before pushing.
  Back up persistent databases first; use expand-and-contract for compatible rollouts.
- `db:push` does not update migration history. Do not assume existing migration
  files or ledger entries describe the current schema.

# Product Catalog Direction
- Before changing product research/catalog behavior, read
  `docs/specs/shared-sku-catalog.md` and the latest `STATUS.md` checkpoint.
  The shared, system-admin-owned catalog is the agreed target, not yet implemented.
  The older organization-scoped spec is historical where it conflicts.

# AWS Guidance
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.
