# Switch the Benstack API to Lambda Web Functions

This uses the existing Terraform state and API hostname. No staging stack or CloudFormation template is needed. Terraform AWS provider 6.72 manages the Web Function resources; the provider uses AWS Cloud Control for some operations, so the deploy identity may still need Cloud Control IAM permissions. The SQS receipt processor and frontend distribution are unchanged.

## Prepare the plan

Use the existing environment's input variables and an authorized AWS profile. Check the account and region, and confirm that an issued ACM certificate for the API hostname exists in `us-east-1` for CloudFront. The Web Function uses the same seven `/benstack/` SSM parameters as the current API; no secret values need to be copied into Terraform or the bundle. If any SecureString uses a customer-managed KMS key, verify scoped decrypt permission before applying.

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd apps/server build:web-function
bun run --cwd apps/server build:lambda
bun run --cwd apps/receipt-processor build
terraform -chdir=infra init -lockfile=readonly
terraform -chdir=infra plan -var='deploy_web_api=true' -var='route_api_to_web_function=true' -out=web-api.tfplan
```

The last two builds are needed because the current stack still references the existing Lambda bundles. Review the full plan: expect the new Web Function, versioned artifact bucket, runtime role, logs, and CloudFront distribution, plus an update to the existing API DNS alias. Stop if the plan changes or replaces the existing Lambda code, receipt-processing pipeline, frontend, or any unrelated resource. Plan files can contain sensitive data; don't commit or share them.

## Apply and verify

After review, `terraform -chdir=infra apply web-api.tfplan` deploys the application and flips DNS in the same apply. The API is not cached, and CloudFront signs requests to the IAM-protected origin. Check `https://<api-hostname>/health` for JSON with `mode: application`, then sign in and load Receipts through the existing frontend. Check `/ready` after that first real API request. Also verify a chat stream and a receipt upload when appropriate.

Persist both enabled variables in your local environment's Terraform inputs after the cutover so subsequent plans don't revert routing or destroy the new resources. The old API deployment workflow does not publish Web Function revisions; for now, rebuild the Web Function and use Terraform to release updates.

## Roll back

Plan and apply with `deploy_web_api=true` and `route_api_to_web_function=false` to restore the existing API Gateway alias without deleting the Web Function. Keep the legacy API and its certificate until the new route is verified and any retirement is handled separately.
