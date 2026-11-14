# Lambda Web Functions staging - prepared, NOT deployed

## Cost and deployment boundary

User approval covers **local preparation only**, not deployment or paid testing.

- No AWS resources, Neon branches, SSM parameters, uploads, DNS changes, database
  operations, workers, or model calls have been created or started by this work.
- This directory is not referenced by the active Terraform configuration. A
  separate CloudFormation template expresses the new Web Function resources
  without changing existing Terraform resources or assuming provider support.
  Review long-term IaC ownership before adopting this as a deployed stack.
- No new GitHub Actions workflow was added. **Existing production deployment
  workflows are unchanged**: pushing these server/package/lockfile changes to
  main can still trigger the existing deployment and schema-push workflow.
  Do not push/merge to main as part of this preparation.
- Keep `EnableResources=no`. Every template resource has that condition.
  Artifact bucket/key/version and a reviewed staging execution role are
  mandatory inputs with no defaults. No upload/deployment script is provided.
- Even with IAM auth and a request rate limit of zero, a deployed stack is
  **not guaranteed free**. Memory, storage, logging and other services can cost
  money. Scale-to-zero and scaling caps are not hard monetary budgets.

The existing API, local Bun server, event Lambda entrypoint, frontend, receipt
processor and research worker remain unchanged.

## What is ready locally

- `apps/server/src/web-function.ts`: separate Hono Node HTTP entrypoint using
  `@hono/node-server`; binds `AWS_LAMBDA_HTTP_ENDPOINT`. Defaults locally to
  `127.0.0.1:3100`.
- `WEB_FUNCTION_MODE=smoke` is the default. It never initializes the application,
  constructs an AWS client, loads secrets, connects to a DB or calls a model.
  It only exposes transport health and a synthetic SSE stream. API routes
  return 503, including authentication.
- `WEB_FUNCTION_MODE=application` enables the full existing application.
  `WEB_FUNCTION_CONFIG=environment` uses the already-loaded local environment,
  without fetching SSM or requiring staging parameters. The default config source
  remains `ssm` for future AWS use. One shared initialization promise prevents
  concurrent startup races; failure stays latched until restart with a sanitized 503.
- Listening is immediate; the existing database setup in `src/index.ts` occurs
  only on the first application request, not within Lambda's 10-second bind
  deadline. No existing startup behavior was changed.
- `GET /health` means **HTTP server listening**, not database readiness.
  `GET /ready` stays 503 in application mode until a real API request completes
  initialization. It never triggers initialization itself.
- Smoke-only `GET /__smoke/stream` emits two fake SSE messages, with no AI calls.

## Safe local commands

From the repository root, with dependencies installed:

```sh
bun run --cwd apps/server build:web-function
bun run --cwd apps/server test:web-function
bun run --cwd apps/server check-types
uvx --from cfn-lint cfn-lint -t infra/web-function-staging/template.json
```

The build and tests use `--no-env-file`. They do not import or execute the real
application. The tests spawn the bundle on loopback with a minimal environment,
no AWS credentials, and smoke mode. Build output is gitignored.

### Full app locally (no deployment)

```sh
bun run --cwd apps/server dev:web-function
```

This builds the new Node server and runs it on **127.0.0.1:3000**, using your
existing `apps/server/.env`, `.env.development` and `.env.local` files (later files
win; explicitly inherited environment variables take precedence). It forces
application mode and the environment config source, so **no staging SSM setup
is needed**. It uses the same database/auth/storage/model configuration as the
normal dev server, not dummy responses. Missing application configuration is
validated by the existing app; it never falls back to SSM.

Stop the old API on port 3000 first; do not run both on the same port. The normal
frontend and its current API URL do not need changing. This command builds once;
restart it after code edits. `WEB_FUNCTION_LOCAL_ENDPOINT` can override the bind,
but a different port/hostname also requires matching frontend/auth settings.
Stop with Ctrl+C. Nothing is deployed, uploaded or provisioned by this command.

**Local does not mean disconnected:** the first application request imports the
real app and runs its normal database/checkpointer setup. Requests can access
your configured hosted DB, S3 or AI provider, with their usual existing usage
costs. Verify your dev targets before starting; running this command is optional
and was not part of the offline validation below. It does not start the separate
research worker or receipt processor.

### Optional smoke-only server

No database or AWS credentials needed:


```sh
env -i PATH="$PATH" WEB_FUNCTION_MODE=smoke \
  AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:3100 \
  node apps/server/dist/web-function/index.js
```

In another terminal:

```sh
curl http://127.0.0.1:3100/health
curl -N http://127.0.0.1:3100/__smoke/stream
```

Stop with Ctrl+C. Neither command deploys anything. Do not set application mode
for this smoke check. For a future ZIP, include **only** generated `index.js`
and `package.json` at its root, never source env files or the whole repository.
All JS dependencies, including SDK clients, are bundled. Native arm64 dependency
compatibility still needs review before a deployment.

## Infrastructure design (inactive)

`template.json` defines only a function, immutable revision and endpoint.
It does not provision its external prerequisites.

- `HomeRegion` endpoint only; no multi-region replication or DNS changes.
- Defaults to smoke mode, Node.js 24 and four concurrent requests/environment.
- IAM-authenticated endpoint; not an anonymous public API. A browser frontend
  cannot use it directly without a separately reviewed access path.
- Starts at `RateLimit=0` (all incoming requests blocked), with at most two
  environments. Enabling traffic is a separate approved action.
- Existing execution role and versioned code bucket/object must be reviewed
  and supplied later. Use a **new staging role**, never the production role.
- No Lambda layers or Parameters and Secrets extension: the new entrypoint
  uses `GetParameters` with decryption through the packaged SSM SDK.

The role must trust `lambda.amazonaws.com` and permit logging only to the
staging function's log groups (`/aws/lambda/web/<function-name>` and its
`.local` group). For application mode, add only `ssm:GetParameters` on the
seven exact staging parameter ARNs, scoped KMS decrypt permission if needed,
and `s3:PutObject` on the isolated staging receipts bucket's `uploads/*`.
Do not grant production SSM, bucket or database access.

The code bucket must have versioning, public access blocking, encryption and a
TLS-only bucket policy. Its Lambda read policy must constrain SourceAccount
and the staging web-function/revision SourceArn. The deployer also needs
GetObject/GetObjectVersion and scoped PassRole permissions. Provisioning these,
uploading a ZIP or creating a stack is **not authorized now**.

## Staging configuration (do not create yet)

For future AWS deployment using `WEB_FUNCTION_CONFIG=ssm` (the default),
application mode requires `WEB_FUNCTION_SSM_PREFIX` to be
`/benstack-staging/` or a child path ending in `/`. The production
`/benstack/` path is rejected. Required suffixes:

| Suffix | Environment variable |
| --- | --- |
| neon-database-url | DATABASE_URL |
| better-auth-secret | BETTER_AUTH_SECRET |
| better-auth-url | BETTER_AUTH_URL |
| cors-origin | CORS_ORIGIN |
| allowed-emails | ALLOWED_EMAILS |
| s3-receipts-bucket | S3_RECEIPTS_BUCKET |
| anthropic-api-key | ANTHROPIC_API_KEY |

Store secrets as SecureString. Do not put secret values in the template.
The path restriction does **not** prove that the stored URL points at a staging
DB: manually verify an isolated Neon branch, separate auth secret, staging URLs,
test identities, isolated receipt bucket and any paid provider key before
enabling application mode. Do not attach the production receipt queue/processor
to staging uploads. Keep research processing and admission disabled by default.

## Remaining approval gates

1. Explicit permission for resources/costs and the target AWS account/region.
2. Review CloudFormation vs Terraform ownership and the external artifact
   bucket/role, logging retention/encryption, alarms and a cleanup plan.
3. Verify actual Node.js 24 / arm64 compatibility and package size. Local
   bundle smoke tests currently ran under Node.js 26, not the deployed runtime.
4. Deploy **smoke only** alongside the existing API, then separately authorize
   request traffic. Even smoke infrastructure can incur AWS charges.
5. Before deployed application mode: verify isolated DB/SSM/bucket targets, back up any
   persistent data, and review schema compatibility. Existing app startup runs
   LangGraph store/checkpointer setup; importing it can issue DB DDL. No schema
   changes, db:push or migration workflow changes are part of this preparation.
6. Authorize deployed application tests separately, especially uploads and AI calls.
   Verify cookies/login, CORS, cancellation, real SSE timing, startup failures,
   tenant isolation, concurrent DB pools and costs.
7. Browser-facing testing/custom domain requires reviewed CloudFront OAC and
   resource policy (plus appropriate abuse protection), preserving IAM origin
   authentication. No frontend switch or production cutover is authorized.

## Validation scope

Local tests cover default-off behavior, synthetic streaming over an actual Node
HTTP socket, shared initialization, sanitized/latched failures, staging-only
parameter paths, the local full-app launcher/config selection, and infrastructure
safety defaults. The local launcher is tested with fake configuration, not by
connecting to the configured database. Type checking and cfn-lint
are local-only. AWS change sets, live runtime/schema validation, real database
initialization, auth flows and actual AI streaming have deliberately NOT run.

References:
- https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html
- https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionrevision.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionendpoint.html
