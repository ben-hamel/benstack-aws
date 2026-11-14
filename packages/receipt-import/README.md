# Shared Costco receipt import and research admission

Phase 1 of [receipt-triggered product research](../../docs/specs/receipt-product-research.md).
Used by the direct Hono upload and the S3/SQS receipt processor. This package does
not invoke models/search, run the SKU worker, approve products, or update categories.
The offline worker/review integration and inbox are now implemented in
[`packages/product-research`](../product-research/README.md), but no paid executor
or production service is enabled.

## Behavior

- Validate the entire upload before writing: array or `{ receipts: [...] }`, bounded
  dates, numbers, strings and collection sizes. Invalid input returns an actionable
  validation failure rather than relying on TypeScript assertions.
- Import each receipt's header/items/tenders/taxes and research admission in ONE
  interactive PostgreSQL transaction. Throw on failures so HTTP/SQS can retry.
  Earlier complete receipts in the same file remain committed; retry skips those
  duplicates and imports only the remaining receipts. `skipped` means duplicate,
  not a swallowed database failure. A zero price/savings amount remains zero.
- Verify current uploader membership in the organization. S3 processing also checks
  the bucket, complete upload key, and persisted job/org/key before fetching data.
- Research only recognized Costco JSON warehouse receipt types (`Warehouse` and
  `In-Warehouse`) with a Canadian province/territory code and a 1-12 digit SKU.
  Explicit foreign country codes, unrecognized receipt types, fuel, adjustments,
  missing SKUs and nonnumeric IDs are excluded with persisted reasons. This is a
  supported import-format check, not cryptographic proof of receipt authenticity.
- Preserve leading zeroes. Deduplicate identities by organization/Costco/CA/SKU.
  An approved name suppresses admission; optional unknown fields do not loop.
- Reuse active requests; failed/rejected/unresolved outcomes have a 30-day cooldown.
  Active states include paused requests, so repeated uploads do not grow that queue.
- Serialize admission with a PostgreSQL transaction advisory lock; future decision
  services must also lock the identity row before changing approved state. Enforce
  active-request/generation uniqueness and association identity in the database.
- Limit queued admission to 20 jobs per UTC day globally and per organization, and
  backlog to 1,000 active requests globally/per organization. Excess daily work is
  paused. Full backlog records a `queue_full` line decision without another request.
- Daily rows count queued job admission only. They are NOT provider usage accounting,
  monetary reservations, or permission to make paid requests.

`research` in the direct-upload response is additive: new queued/paused jobs,
reused requests, approved identities, excluded lines, cooldowns and capacity-blocked
identities. S3 import-job `done` still means receipt import complete, not research
complete. Paused requests are stored for the later inbox, not automatically resumed
by this package.

## Configuration and database adapters

`PRODUCT_RESEARCH_ADMISSION_ENABLED` defaults to false; only the exact value `true`
permits queuing. `PRODUCT_RESEARCH_ORGANIZATION_IDS` is a comma-separated allowlist
and defaults to empty. Disabled/non-allowlisted work gets paused requests, not paid
calls. There is no deployed/live consumer; the explicit offline runner and review
API/UI are implemented separately. Do not enable production admission until the
hosted worker and operational gates are implemented.

Imports use `@benstack-aws/db/transactional` (`pg` + Drizzle), including Neon URLs.
Neon's standard PostgreSQL/TCP endpoint supports interactive transactions; the
existing app HTTP adapter cannot support this callback boundary. Other app reads
retain their existing adapter. Use the provider-issued TLS connection string; do
not disable certificate verification. Pools are bounded/reused per process.
Actual hosted Neon/RDS connectivity must be staged before rollout; offline tests
are not proof of network reachability, TLS configuration or permissions.

The Lambda now requires `S3_RECEIPTS_BUCKET` in addition to `SSM_PARAMETER_PATH`.
`infra/lambda.tf` supplies this for both configured database modes, but has NOT been
applied. Coordinate configuration/schema BEFORE any code deployment.

## Migrations and rollout caution

No migration or deployment was applied while developing Phase 1.

- `0001_receipt_import_baseline.sql` brings migration history up to the already
  existing receipt/chat/category schemas, which previously existed via `db:push`
  but were absent from the auth-only migration snapshot. It uses guarded DDL to
  avoid recreating matching existing objects and adds `pg_trgm` on fresh databases.
- `0002_product_research_admission.sql` adds product identities, approved-product
  scaffolding, requests, line decisions/associations and daily admission counts.
- `0003_product_research_review.sql` and `0004_product_research_action_keys.sql`
  add fenced claims, immutable proposals/decisions, and re-research idempotency.
- Generated snapshots/journal describe these changes. Existing reference category
  seeds and historical receipt values are not rewritten.

**Even disabled admission requires the new tables.** Do not deploy the new importer
before the schema exists. Before production, back up and restore into an isolated
copy, compare its columns, defaults, enum values, constraints and indexes with the
baseline snapshot, and rehearse the upgrade there. Guarded DDL is not a schema-drift
repair tool and does not certify arbitrary existing tables as compatible. Also
inspect the migration ledger: an installation managed only by `db:push` may not have
recorded the old auth migration. Do not blindly replay `0000` against existing auth
tables or mark unknown migrations applied. Reconcile the ledger from a verified
schema as a separate reviewed rollout task.

Current main-branch workflows can deploy automatically and use `db:push`; merging
these changes is not a substitute for coordinating this schema/configuration order.
No deployment workflow was run in this phase. Existing partial historical receipts
need an explicit diagnostic/repair operation; this package does not guess how to
repair or silently backfill them. Receipt-deletion cancellation, approval/provenance,
worker claims, structured proposals and the inbox are implemented for offline
validation. Terminal artifact cleanup/retention, paid-provider accounting and the
live hosting/recovery gates remain required before production enablement.

## Tests

```bash
bun run --cwd packages/receipt-import check-types
bun run --cwd packages/receipt-import test
bun run --cwd apps/server check-types
bun run build:lambda
```

Default tests use pinned PGlite 0.5.15 (PostgreSQL compiled to WASM), the actual SQL
migrations/constraints and Drizzle interactive transactions. No Docker, credentials,
remote database, model calls or AWS access are needed. Hono route tests inject the
shared importer and a fixture identity; S3 tests inject the object reader. They test
JSON/multipart and S3 boundaries, rollback, quota/cooldown/deduplication, membership,
input limits, redelivery, and baseline preservation. WASM serializes transactions;
its concurrent Promise tests do not establish multi-connection locking correctness.

CI additionally runs the same suite against a disposable PostgreSQL 16 service
through the production `pg` adapter, covering actual multi-connection transactions.
To run that backend locally, use ONLY a disposable local database:

```bash
RECEIPT_IMPORT_TEST_DATABASE_URL=postgresql://test:test@localhost:5432/receipt_import_test \
  bun run --cwd packages/receipt-import test
```

**This test backend drops its schemas.** It refuses nonlocal hosts and database
names outside the `receipt_import_test` prefix; it never reads `DATABASE_URL` or
application environment files. Do not point it at real data.
