# Benstack API on Lambda Web Functions

Terraform manages the Web Function, its versioned S3 bundle, and the CloudFront API distribution. CloudFront signs requests to the IAM-protected origin and does not cache API responses. The existing API hostname, certificate, frontend distribution, and SQS receipt-processing pipeline are retained. The old API module now manages only the certificate and its DNS validation records.

## Release an API revision

Use the existing environment's Terraform variables and an authorized AWS profile. Confirm the account and region first. CloudFront needs an issued certificate for the API hostname in `us-east-1`. The Web Function reads the existing seven `/benstack/` SSM parameters at runtime; never put their values in the bundle. If a SecureString uses a customer-managed KMS key, grant the execution role scoped decrypt permission for that key.

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd apps/server test:web-function
bun run --cwd apps/receipt-processor build
terraform -chdir=infra init -lockfile=readonly
terraform -chdir=infra plan
```

The Web Function test command builds its deployment bundle. The receipt processor build is required for a full plan because Terraform still references that bundle. Review the plan before applying: a Web Function release should publish a new revision and update its endpoint, not redeploy a receipt processor or change unrelated IAM rules. If a full plan includes unrelated drift, resolve it separately or scope the release plan to `-target=aws_lambdaweb_function_endpoint.api`.

After applying, check `https://<api-hostname>/health` for JSON with `mode: application`, then sign in and load Receipts through the existing frontend. `/ready` returns `200` after the first real API request completes initialization. If needed, roll back by rebuilding the last known-good Web Function code and publishing it as a new revision.
