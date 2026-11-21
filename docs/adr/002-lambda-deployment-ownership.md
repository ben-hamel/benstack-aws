# ADR 002: Lambda deployment ownership

## Current deployment paths

- **HTTP API:** Terraform owns the Lambda Web Function, its versioned S3 bundle, and endpoint routing. Releases publish an immutable revision and update the endpoint. See the [Web Function release runbook](../web-function-cutover.md).
- **Active receipt processor:** GitHub Actions builds and deploys the SQS-triggered Event Function via `.github/workflows/deploy-lambda.yml`. Terraform manages its configuration and queue mapping but still derives `source_code_hash` from a local bundle.
- **Legacy receipt processor:** Terraform retains the RDS-connected function and its networking. It is not the active queue consumer. See the [legacy resource retention notes](../lambda-cutover.md).

## Open issue: receipt processor code drift

GitHub Actions packages the receipt processor with `zip`, while Terraform uses `hashicorp/archive`. Different Bun versions, build inputs, or ZIP metadata can make a Terraform plan propose a code update even when there is no intended receipt processor release. Do not apply an unexpected code update as part of an unrelated infrastructure change.

The remaining ownership decision is whether to make GitHub Actions the sole owner of the active receipt processor's code updates or move releases to Terraform. Resolve that separately from Web Function releases. After changing ownership, verify that a receipt processor release does not produce an unexpected code change in the next full Terraform plan and that queue mapping and infrastructure changes remain detectable.
