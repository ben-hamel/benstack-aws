# Where I left off: shared SKU catalog refactor

Updated: 2026-11-08

## Latest checkpoint: shared-catalog specification written, implementation not started

Source of truth for the next work:
[docs/specs/shared-sku-catalog.md](docs/specs/shared-sku-catalog.md).
User confirmed that product knowledge is shared across ALL users, while receipts
remain private. Product research is a SYSTEM-ADMIN catalog operation, not an
ordinary user or organization-owner feature. Initial global identifications need
human system-admin approval; eligible historical/new receipts read approved shared
metadata without financial rewrites. Catalog knowledge survives tenant deletion.

Wrote the durable spec with named ASCII diagrams, agreed decisions, data/privacy
boundaries, global deduplication, system authorization, worker/deletion semantics,
legacy evidence/conflict mapping, safe historical backfill, db:push-based
expand-and-contract, bounded work packages, acceptance checks and cross-agent
handoff rules. Added a supersession notice to the old org-scoped spec and an
AGENTS.md pointer. All shared-catalog phases are NOT STARTED. This run changes
DOCUMENTATION ONLY: no application/schema change, DB push, role grant, backfill,
provider request, worker restart, production operation or deployment.

Documentation validation: git diff --check passed; relative Markdown links, code
fences and control-character checks passed for both specs, STATUS.md and AGENTS.md.
No runtime test suite was rerun for this documentation-only change.

Next bounded action, when implementation is requested: Phase 0 inventory/freeze.
Read AGENTS.md + the new spec, inspect current worktree, verify target/worker
state and actual schema/legacy duplicates, and confirm how to designate the first
system admin. Org owner status/ALLOWED_EMAILS is not system authority. Do not
silently convert previous owner approvals into globally approved knowledge.
Pause/inspect legacy research before ownership/cutover work; never run two live
queues for one SKU. Spec approval is not authorization for persistent schema
pushes, destructive conversion, role grants or more live calls. Do not switch
from db:push to a migration-based workflow.

Updated observed runtime history: the automatic dev test DID complete after the
previous checkpoint. Request `f32892bf-70fd-4a67-822e-426a5d4cc865`, SKU 1218213,
was queued through the UI, researched using the ChatGPT plan and published
awaiting_review as Dempster's 10-in White Tortillas, pack of 18. User screenshots
show matching Costco Business Centre item 1218213 and the review proposal. The
worker then exited normally at job_limit (attempted 1, published 1), verified in
Rex output. Do not assume it is running or start it to inspect saved state.
Read-only SQLite inspection reported 5,501 main-model input + 488 output = 5,989
tokens, four model responses, three search-tool calls, one page-fetch call, one
tool error and 72.21 seconds. Hosted-search model tokens were NOT captured; library
API-price estimates are not actual ChatGPT charges. No research was rerun to obtain
these numbers. No automatic usage-report feature has been implemented yet.

The normal dev app's ignored environment still has org-scoped admission enabled
for ben-local from prior work. This spec did not change that setting or the old
research UI/permissions. Verify running services, pending work and target before
starting the refactor. Existing code/DB still implement the legacy org-scoped model.
Earlier approved butter evidence and pending tortilla evidence must be preserved;
size/brand/pack extraction remains a separate improvement. Detailed API-key usage
accounting remains deferred by user choice, with basic execution safeguards kept.
All feature and documentation changes remain uncommitted. See older checkpoints
below for test suites, dev URLs, backup locations and process IDs; those are
historical observations, not current guarantees.

## Previous checkpoint: ChatGPT automatic dev Research Worker connected and waiting

User explicitly approved connecting automatic processing to the existing ChatGPT
plan worker, deferring detailed token/cost accounting until an API-key version.
Keep basic protections; do not reintroduce a blanket billing-implementation gate
for this explicitly consented local development run. No production deployment or
API-key fallback is authorized by this change.

Added distinct `runAutomaticChatGPT` (`automatic-chatgpt.ts`), requiring explicit
allowLive, a chatgpt-plan executor, enabled org policy and current owner/admin
membership on EVERY claim. Provider-neutral polling/shared claim execution handles
serial claims, finite per-process caps, heartbeat fencing and bounded publication
retry without repeating inference. Offline entrypoints still reject live executors.
Shared Node subprocess adapter in `apps/sku-worker/pilot/subprocess.ts` is reused
by manual and automatic commands; no DB/AWS/API-key/runtime-injection env enters
the child. Existing private request-ID SQLite/JSON exports remain reusable; no
interrupted/terminal/expired job is automatically restarted. Execution failure
stops the worker. Approval remains explicit in the app.

New command: `bun run sku:auto -- --allow-live --max-jobs 1`, pinned to the verified
Neon ben-local DIRECT endpoint, separate ChatGPT plan grant, no daemon auto-start
through the API. Defaults disabled without consent; one attempt per process start,
no automatic process restarter. Optional finite --max-jobs up to 100 is explicit.
Pause new claims via `<worker-state>/auto-coordinator/PAUSED`; Ctrl+C cancels the
current child, with a bounded SIGKILL fallback. Detailed usage reservations,
per-job token/dollar caps and automatic operator recovery remain deferred, NOT
implemented. ChatGPT plan windows are not hard per-job caps.

Updated ONLY ignored `apps/server/.env.local` to enable admission for the existing
owner org `479d6d47-803b-4b90-92a8-1d00dc00f176`. No schema push/migration or
production configuration change. Restarted dev API/frontend in new Rex window
`window:01a1b8ef-4e25-7e77-bd99-ae5e722b6c53` (App servers), server block
`block:01a1b8ef-4e22-7ea5-98d6-78d47b1a8a5a`. API port 3000 and Web App
`http://100.67.130.3:3001/product-research` both respond HTTP 200. Old server block
was stopped, logs retained. Live Research Worker started alongside in Rex block
`block:01a1b8ef-7121-7332-be16-ccc2e71269db`, max-jobs 1. It is verified running
and WAITING; no new live research call occurred during setup. Check process before
assuming it is still running later. All 31 old paused requests were left paused;
existing approved butter remains approved.

UI now explains queued/paused processing rather than claiming execution is never
enabled. Paused detail button is **Queue research**, with explicit allowance
acknowledgment; existing owner-authorized research-again API promotes only that
request through admission quotas. Newly imported eligible products may queue
normally. Use direct **Upload (dev)**, not unisolated production S3 upload.

Validation: all 65 Node worker tests, 47 native PostgreSQL tests, 46 PostgreSQL/WASM
plus one native-only skip, workspace types, frozen install, diff checks and 3
Chromium flows pass. New tests cover separate live consent gate, tenant/current-role
authorization, one-job cap, UI queue action waking the consumer with faux results,
no auto-approval, publication lost-ack idempotence, failure stopping, expired-running
non-reclamation, subprocess env isolation, saved-export identity, cancellation and
no relaunch on child failure. No live provider calls were used in tests. Native
fixture containers/volumes removed. Logs: `/tmp/benstack-chatgpt-*.log`.
All changes remain uncommitted.

NEXT: user refreshes Product research, chooses PAUSED, selects ONE product,
acknowledges allowance and clicks Queue research. Research Worker should pick it
up automatically, publish awaiting_review or unresolved, and exit at the one-job
cap. This automatic live end-to-end run has not yet been observed; earlier butter
run was the manual pilot. Do not queue/research the entire paused backlog silently.

## Previous checkpoint: automatic Research Worker plumbing verified OFFLINE ONLY

User approved building automatic processing with fake providers first, keeping live
execution disconnected until usage/recovery protections are ready. Implemented
`packages/product-research/src/automatic.ts`: default-off, explicit org policy,
sequential polling, one attempt per process by default (finite 1-100 offline jobs),
runtime policy recheck and AbortSignal stop. It never promotes paused requests or
accepts a live executor. Starting the normal App API still starts no worker.

`runNext` now optionally retries ONLY transient DB publication failures, at most
three attempts with the same parsed result, never repeats execute/inference.
Default remains one publication attempt for existing callers. Permanent/stale
errors stop; exhausted/uncertain publication retains the running claim. Heartbeat
shutdown waits for pending renewal. Duplicate uploads and process restarts do not
replay terminal/running jobs, and expired leases are NOT automatically reclaimed.
Execution failure stops the automatic session instead of draining later requests.
A per-process maxJobs value is NOT a persistent monetary/token cap: unattended
live execution remains unavailable pending durable usage/inner-search accounting,
explicit recovery/republishing, reviewed adapter and deployment/monitoring gates.

Added `bun run sku:auto:offline`: --no-env-file, default disabled; explicitly enabled
command accepts ONLY local disposable receipt_import_test DB URLs, never normal
DATABASE_URL, Neon, app env files or worker credentials. It imports no model/search/
page adapters, saves private synthetic unresolved JSON before publication, and
provides a PAUSED-file stop for new claims. It creates no schema or receipt data.
Actual entrypoint was exercised against disposable native PG fixture data; no
persistent local app/Neon database was touched by this task. The isolated browser
demo's automatic pump now uses the same scheduler with its static fictional results.

Validation: 61 Node worker tests, 40 native PostgreSQL queue/review tests (including
actual offline CLI export/publication), 39 PostgreSQL/WASM tests plus one native-only
skip, 7 demo API tests and 3 Chromium browser flows pass. Workspace type checks,
frozen install, command help and diff checks pass. Tests explicitly cover upload
pickup, concurrent workers, finite caps, duplicate uploads/restarts, expired-running
non-reclamation, failure stop, cancellation/pause, transient retry exhaustion,
permanent error non-retry and lost commit acknowledgment without reexecution.
Logs: `/tmp/benstack-auto-*.log`. Native fixture container/volume removed. No new
live model/search/page calls, schema push, hosted DB writes or deployment occurred.
All implementation remains uncommitted.

User's first live manual pilot DID run before this task: request
`1c9ec35c-8c6a-433c-8754-f3be8f533d84`, SKU 118219, using gpt-6.1-sol reasoning
and hosted search, published direct Costco evidence identifying Natrel Salted
Butter, 454 g. User approved name+brand and confirmed enrichment on linked receipt
2026-09-26, ST JOHNS, $357.31; original BUTTER 454G and receipt financial facts
remain separate. Size is still unknown in structured metadata despite explicit
454 g on source page: saved-evidence extraction improvement remains pending,
without a need for another inference run. That manual pilot is distinct from this
offline-only automatic scheduler. ben-local automatic admission stays paused;
production main remains untouched. Next: review/checkpoint, size extraction if
wanted, then reviewed live usage/recovery controls BEFORE unattended real execution.

## Previous checkpoint: one-request dev research bridge built, no live run

User clarified the project uses `db:push` for ALL dev/prod schema work. AGENTS.md
now records that workflow, target/SQL/backup checks and expand-and-contract. Do not
switch to migrations without approval. Earlier migration reconciliation below is
historical work already applied to ben-local, NOT the future rollout policy.
No schema change was made while building this pilot.

Normal API + Vite are running in Rex block
`block:01a1b89f-6709-7dfc-a15e-bc2a74fb7fac`, command
`bun x --no-install turbo dev --filter=server --filter=web --ui=stream`.
Web: `http://100.67.130.3:3001`; API: port 3000. Check processes before relying
on this. User logged in to ben-local (dev-only password reset requested; credentials
are in a private file outside Git), confirmed reads, then imported via **Upload
(dev)** `/receipts-upload`: 12 receipts imported, 11 duplicates skipped, 32 product
requests paused, zero queued. User verified the paused inbox. The regular Receipts
Upload JSON button still presigns S3 and failed browser upload; do NOT use it for
isolated dev testing because its AWS processing is not a verified dev pipeline.
Use the direct dev upload instead. No production receipt deletion or cleanup ran.

Implemented separate `bun run sku:pilot` Bun coordinator in
`apps/sku-worker/pilot/cli.ts`, Node durable subprocess in `src/pilot-worker.ts`,
and shared `manual-pilot.ts`/exact `claimSelected` queue path. CLI defaults to
read-only list/inspection, requires one request UUID and `--allow-live` to execute,
and is pinned to the verified ben-local DIRECT hostname with TLS verification.
Current owner/admin membership and ALLOWED_EMAILS are checked. Paused promotion
uses existing admission quotas; only the selected request can be claimed. The
existing offline-only `runNext` gate is unchanged, no daemon or HTTP live endpoint.
Node subprocess receives no DB/AWS/API keys or runtime-injection environment,
only basic OS variables and optional SKU state directory. Explicit execution uses
the existing separate ChatGPT plan login, NEVER ambient API-key billing/fallback.

Real durable SQLite evidence is exported before publication; direct-page structured
fields only, never answer prose. Result becomes awaiting_review or unresolved,
never auto-approved. Jobs use `<worker-state>/pilot-jobs/<request-id>/`, separately
from old CLI jobs. Completed exports are identity-checked/reusable; interrupted
transcripts do not silently restart. Execution/abort fails closed retaining saved
state; DB publication failure leaves running claim for operator inspection. No
saved-result republishing/recovery CLI in this first pilot. Do not reset/requeue
or create a new generation blindly after a failure. Five-minute deadlines,
12 tool calls and eight turns bound execution, NOT a monetary/token/inner-search cap.

Validation: all 58 Node worker tests pass (5 new pilot tests), all 27 review/queue
DB tests pass on both PostgreSQL/WASM and disposable native PostgreSQL 16 (9 new
pilot tests), workspace type checks, frozen install and diff checks pass. Native
test container and volume removed. Logs: `/tmp/benstack-pilot-*.log`. Read-only
`sku:pilot` listing against ben-local succeeded; no worker credentials were read,
no paused request was promoted, and NO live model/search/page call was made.
Dependencies added only existing workspace DB and existing catalog @types/bun.
All changes remain uncommitted. Next: user explicitly approves one live request
and ChatGPT-plan usage, confirm worker login if needed, then run one selected UUID
and inspect real evidence/review in the app. Production/live-service gates remain.

## Previous checkpoint: Neon ben-local development branch expanded

User created Neon `ben-local` as a data+schema child of `main`, chose to retain its
copied data, saved its DIRECT URL to ignored `apps/server/.env.local`, and explicitly
authorized migration. Connection endpoint was checked against the ben-local console
screenshot: `ep-bold-frog-amsb7vxz.c-5.us-east-1.aws.neon.tech`, database `neondb`.
No main/production connection or AWS secret was accessed or changed.

Public/reference columns, enums, constraints and indexes exactly matched the
fresh 0000+0001 baseline, but the existing migration ledger was empty, consistent
with db:push-managed schema. After exact schema verification, recorded only the
verified existing 0000 auth migration hash/timestamp, then applied 0001-0004 using
the actual Drizzle node-postgres migrator. Before touching the Neon schema, took
a custom pg_dump backup, restored it locally and successfully rehearsed the same
ledger reconciliation and migration. All pre-existing non-ledger table counts and
whole-row fingerprints remained unchanged both on the restored copy and Neon.
Final dev ledger has five entries. No db:push or destructive data cleanup ran.

Private artifacts: `/home/ben/.local/state/benstack-db-rehearsal/neon-ben-local-20261108/`
contains backup, SHA-256, before/after manifests, ledger and schema comparison,
preflight script and log. Treat as sensitive copied production/auth data; never
commit/upload. Files are 0600 under 0700 directories. The first dump attempt failed
certificate verification using container CA roots, before schema writes; successful
retry used the host CA bundle with verify-full, without disabling verification.
The rootless local rehearsal container/volume was stopped and removed afterward.

IMPORTANT: normal server config now targets Neon ben-local rather than the original
localhost DB. The running synthetic demo still uses its isolated in-memory DB.
No full normal-app auth/import/UI smoke test against Neon has yet been run; live
research stays disabled. Production/main schema and migration ledger remain
unverified/unmigrated and need their own preflight before any rollout. New migrations
must be reviewed SQL migrations, not blindly mixed with db:push.

## Previous checkpoint: local backup and migration-copy rehearsal passed

User authorized backup/rehearsal of the LOCAL database only. Read connection
settings without printing credentials from `apps/server/.env.local`; source was
`localhost:5432/benstack-aws`, PostgreSQL 17.11. Took a custom-format logical dump
plus schema dump using PostgreSQL 17 clients, then restored into a separate
rootless Podman PostgreSQL 17 instance bound to `127.0.0.1:55433`. Never ran DDL,
migrations or writes against the source; hosted databases were not accessed.

Private backup and rehearsal artifacts (outside Git):
`/home/ben/.local/state/benstack-db-rehearsal/20261107T235911Z/`.
Contains `local-app.dump`, SHA-256 checksum, schema, metadata, before/after
count+fingerprint manifests, comparison JSON, rehearsal script and log. Parent
backup directories are mode 0700; files are 0600. Backup contains local user/session
and application data: keep private and do not upload/commit it. This is a local
logical backup, not an off-machine backup or point-in-time recovery setup.

Compared all public/reference columns (types/defaults/nullability/order), enums,
constraints and indexes against a fresh 0000+0001 baseline: zero differences.
Existing ledger had exactly 0000, with matching timestamp and SQL SHA-256 hash.
Applied pending 0001-0004 using the actual Drizzle node-postgres migrator to the
restored copy only: success, five ledger rows. A second migrator run succeeded
without adding rows. All pre-existing non-ledger tables retained identical counts
and whole-row fingerprints, including auth, chat, LangGraph and category maps.
IMPORTANT limitation: source receipt tables were empty, so this copy cannot prove
preservation of populated historical receipts; synthetic native-PG tests separately
cover baseline adoption and receipt financial preservation.

Stopped and removed the rehearsal container and anonymous volume; private dump
remains. Local source database is still unmigrated. No production changes or paid
calls. This verifies local expand compatibility, not hosted-schema equivalence,
zero-downtime lock behavior under load, or production auth/provider connectivity.
Next: review/checkpoint and coordinate an explicit local expand/code rollout if
requested; do not run db:push or auto-deploy to main as a shortcut.

## Previous checkpoint: native PostgreSQL tests and Tailscale walkthrough

Ran both database integration suites against a disposable rootless Podman
PostgreSQL 16.15 instance on `127.0.0.1:55432`: 20 receipt-import tests and 18
research/review tests passed, including multi-connection concurrency, rollback,
deduplication, quota, claim fencing and conflicting approvals. The first attempt
started before PostgreSQL initialization finished; reran after readiness succeeded.
Stopped and removed the test container and its anonymous volume afterward. No
normal application database or credentials were used. Logs:
`/tmp/benstack-native-import-test.log`, `/tmp/benstack-native-research-test.log`.
This is a local native-PostgreSQL pass, not a claim that remote CI ran.

User completed synthetic upload, selected-field oats approval, laundry rejection,
and receipt verification from their Mac via Tailscale. Receipt retained original
facts and $10/$15/$25 amounts. Demo now accepts `--host` with loopback or a specific
Tailscale IPv4 only; backend remains loopback, and mutations require the exact
frontend origin. Started with `bun run demo:research -- --host 100.67.130.3` at
`http://100.67.130.3:4173/receipts`, logs in
`/tmp/benstack-research-demo-tailscale.log` (check process before assuming it runs).
Anyone permitted to reach this tailnet port can use its fake-owner session.
Fixed frontend demo detection for that origin and secure-context-only randomUUID
usage in review actions with a Web Crypto getRandomValues UUID fallback. Demo API
suite: 7 pass; UUID helper tests: 2 pass. Demo type checks and web check-types/build
command passed. Changes remain uncommitted.

Still pending: review/checkpoint, migration ledger/schema compatibility rehearsal
on an isolated restored backup, production auth/connectivity, and live research /
operational gates. No production migration, deployment or paid call was made.

## Previous checkpoint: disposable browser demo verified

Prepared `apps/research-demo` and fixed the existing citation type error by moving
preview delays from the Base UI Root to its Trigger (`delay` / `closeDelay`). Full
workspace type checking and the workspace build now pass.

Demo command: `bun run demo:research`.
Current session: a fresh empty demo is running on the dev machine at
`http://127.0.0.1:4173/receipts` (loopback only). The API health check
`/api/demo/info` confirms `syntheticOnly: true`, `storage: memory`, and providers
`disabled`. Do not assume this process is still running in future sessions.
Logs: `/tmp/benstack-research-demo-current.log`. For remote access, forward port 4173;
see `apps/research-demo/README.md`.

The yellow banner provides a fictional receipt download and Reset button. Normal
receipt upload uses a local upload slot, then the real shared queue/review services
with static fictional results. It rejects real/modified receipts before persistence,
uses a fake owner session and a new in-memory PostgreSQL DB, does not import the
normal server/env bootstrap, and strips inherited database/AWS/provider settings.
No model, search, source-page or AWS calls are made by the demo. Source references
are clearly synthetic, non-clickable text. Normal application defaults stay gated.

Validation: 103 tests pass: 20 imports, 18 review/API, 53 Node/Pi worker, 3 React
rendering, 6 demo isolation/API, and 3 actual Chromium browser flows. Browser checks
cover sample upload, review badge, selected-field approval, rejection, unchanged
receipt amounts/descriptions, refusal of real inputs, sample download/reset, no
browser JS errors, and no external page requests. Full workspace type checks,
workspace build, frozen install and diff checks pass. CI includes browser validation.

Playwright 1.64.1 was installed under the normal release-age policy. On this minimal
Fedora 44 host its browser needed libraries and fonts: signed Fedora RPMs were
verified and extracted into `~/.cache/benstack-browser-libs/`, without sudo or system
installation. That cache is used only by the test browser, not the app/API process.
Browser binaries are under the standard Playwright user cache. Test screenshots
are ignored under `apps/research-demo/test-results/`.

All implementation work remains uncommitted; only spec commit `7bf534d` is committed.
No production database, deployment, personal worker state or paid-provider account
was touched. Next: user walkthrough, checkpoint/review, native PostgreSQL CI and
migration/config rehearsal on a restored copy, then funded provider/hosting/budget,
retention and recovery gates before production. This synthetic demo validates the
workflow, not real product identification or production authentication/connectivity.

## Previous checkpoint: offline worker bridge and approval inbox

Continued from the existing uncommitted Phase 1 work without discarding it.
Implemented `packages/product-research`: shared runtime-validated result/action
contracts, opt-in single-active offline queue claims/renewal/fenced publication,
scoped inbox/detail APIs, owner/admin selected-field approval/rejection with atomic
before/after audit, version checks and idempotency, and a separate durable admission
key ledger for re-research. Receipt deletion cancels orphaned unpublished work.

`apps/sku-worker/src/queue-executor.ts` bridges explicit faux models/fixture web
access to real Pi Durable SQLite jobs keyed by request UUID. Structured candidates
come from committed direct-page fields, NEVER final-answer prose. Results persist
before publication and can be read without inference; missing state fails closed.
Search-only prose remains unresolved, size conflicts/estimates remain quotes, and
variant/pack fields are not inferred. No live provider adapter or auth fallback exists.

The app now has `/product-research`, a navigation review badge, scoped list/detail,
source quotes and warnings, explicit field selection, reject/re-research controls,
and decision history. Receipt reads/display use approved metadata separately from
original financial facts. Unsupported/foreign and legacy unassociated lines do not
silently gain Canadian metadata from matching SKU digits. Latest request links
follow new generations. Main upload completion distinguishes research from import.

Prepared (not deployed) migrations `0003_product_research_review.sql` and
`0004_product_research_action_keys.sql`, with generated snapshots/journal. Added
native PostgreSQL CI coverage and evidence rendering tests. See
`packages/product-research/README.md` for the implementation, commands and limits.

Validation: 20 import tests, 18 queue/review/API tests, 53 Node SKU/Pi tests, and
2 React evidence-render tests pass offline (93 total). Targeted core, importer,
SKU and server type checks pass. Workspace build, migration metadata, Terraform
format/validate, and diff checks pass. Full browser interaction/real-provider acceptance
has NOT been run. Native multi-connection PostgreSQL is configured in CI but not
claimed run locally; local DB tests use PostgreSQL/WASM. The existing unrelated
`inline-citation.tsx:53` `closeDelay` error remains the full web type-check blocker.

All implementation changes remain uncommitted; only the spec is committed as
`7bf534d`. No production DB migration, AWS deployment, personal saved-job access,
or paid research was performed. Admission remains default-paused; no live daemon
starts automatically. Next: checkpoint/review the changes, pass native PostgreSQL
CI and browser acceptance, rehearse the schema/ledger/config rollout on a backup
copy, then settle provider funding, worker hosting, spending/accounting, artifact
retention and recovery/monitoring before production enablement.

## Previous checkpoint: Phase 1 import/admission foundation

Spec committed as `7bf534d`. Phase 1 implementation is in the working tree:
- New `packages/receipt-import` validates Costco JSON and shares per-receipt
  transactions between direct Hono upload and S3/SQS processing. Failed child or
  admission writes roll back the header; retries skip only complete duplicates.
- New scoped identity/approved-product scaffolding, research requests, per-line
  admission reasons/associations, daily quotas, and DB-enforced active deduplication.
- Admission defaults to paused, requires an explicit org allowlist to queue, and
  does not invoke any worker/model/search or provide an approval endpoint/UI.
- Membership checks, exact S3 job/org/key/bucket checks, bounded input, sanitized
  failures, and a real PostgreSQL callback-transaction adapter for imports in both
  database modes. Existing category mappings/receipt financial data stay separate.
- Prepared migration `0001` adopts the existing non-auth schemas missing from
  migration history; `0002` adds admission tables. Snapshots/journal are generated.
- Added a PostgreSQL 16 CI test service and updated Lambda build path triggers.
  Terraform supplies the newly required `S3_RECEIPTS_BUCKET` Lambda setting only;
  no infrastructure was applied.

Validation: 20 new isolated import/HTTP/S3 tests and all 49 SKU worker tests pass.
Importer/server/Lambda type checks, workspace build, Lambda bundle, Terraform
format and validate pass. Full-workspace type checking is blocked by an unrelated
existing `closeDelay` prop error at
`packages/ui/src/components/ai-elements/inline-citation.tsx:53` (left untouched).
Local DB tests use PostgreSQL/WASM (PGlite 0.5.15, installed without release-age
exceptions); local Docker access was denied, so actual multi-connection pg tests
are configured in CI but not claimed run here. Hosted Neon/RDS connectivity/TLS
and live AWS receipt delivery also remain staging checks.

**Do not deploy yet:** review the compatibility baseline and existing migration
ledger against a backed-up database copy, apply schema/config in a coordinated
rollout, and finish worker/approval/deletion/recovery gates. Existing main-branch
workflows can auto-deploy and still use `db:push`; do not blindly merge as a rollout.
No production DB, AWS deployment, personal saved job, or paid research was touched.
Implementation changes are not yet committed. See `packages/receipt-import/README.md`
for commands, adapter choices, limits and explicit remaining work.

Next: review/checkpoint this foundation, pass the native PostgreSQL CI suite, then
implement the structured worker result/publishing boundary and review service/UI.

## Previous checkpoint: receipt-triggered production specification

Specification: `docs/specs/receipt-product-research.md`.

The agreed user workflow is automatic research after receipt import, with explicit
human approval before product metadata is applied. No per-SKU terminal command
should be required. The draft grounds this in both existing receipt import paths,
identifies the missing catalog/review schemas and unsafe nontransactional import
boundary, and specifies deduplication, scoped approval, UI, hosting, spending
controls, recovery, implementation phases, and acceptance checks.

Technical defaults in the spec are recommendations for one-pass review, not
previously approved decisions. Provider/service credentials and monetary/infrastructure
budgets remain launch gates. Start implementation with transactional shared import
and admission, not deployment. The draft does not authorize paid requests, migrations,
or infrastructure changes. Spec writing changed documentation only; no runtime
validation was needed or claimed. The user authorized starting Phase 1 on November 7;
paid calls, production migrations, and deployment remain gated.

## Previous checkpoint: Pi Durable 1.5.0 migration

Completed the partial 1.5.0 upgrade already present in the working tree:
- Pi Durable, Pi AI, Chord, and Pi Schema are pinned together to 1.5.0.
- Tool definitions use Pi Schema, and harness reports use the tagged report API.
- Progress now watches bounded conversation views, not the removed `watchEvents()`
  API. It emits fixed labels only, deduplicates live/result completion updates,
  and does not replay old progress when reopening a completed job.
- Removed parked-task recovery and `retryTask()`. The obsolete CLI `retry` command
  now rejects with guidance before authentication/network discovery/state access.
- Hard crashes during a model request settle `unanswered` as `interrupted` with
  our disabled-model-retry policy. Five crashes during a read-only tool end that
  tool with a `restart_limit` result; the model can still answer from saved evidence.
- Graceful Ctrl+C/close and resume remain supported for model and search work.
  Failed submissions are not silently restarted; fix the cause and explicitly
  start new research if needed. Completed jobs reuse their saved answer/review.

Validation: type checking and all 49 offline tests passed, including real SIGKILL
fixtures, graceful pause/recovery, stable input/budget identity, safe progress,
obsolete CLI rejection, and SQLite schema migration preservation. No live model,
search, page, login, or original saved-job migration was performed. No dependency
installation or release-age override was needed to finish the existing upgrade.

**Before using existing jobs:** stop workers and back up closed SQLite databases
and any WAL files. Built-in document/task upgrades can make rollback to 1.4.0
unsafe even though SQLite remains schema v2. The schema-preservation test is not
comprehensive legacy built-in-state migration coverage. See
`apps/sku-worker/README.md` for current usage and upgrade notes.

No deployment or infrastructure changes. Implementation and offline validation are
complete. The broader product decision remains whether to stop at the local
prototype or expand coverage.

---

The remaining sections are the historical October 23 prototype checkpoint, not
current upgrade instructions.

## Goal

Explore a single-user local Costco Canada SKU research worker using Pi Durable,
ChatGPT plan-use authentication, and hosted web search. Results are proposals for
human review, not approved catalog updates. This is a prototype, not a deployed
service or production integration.

## Where I stopped

- Repo: `/home/ben/code/benstack-aws`
- Branch: `feat/durable-sku-worker`
- `6a0c886`: committed the local worker, tests, documentation, package script,
  and dependencies.
- `8f63eaf`: committed the intentional removal of the overly broad Secret Safety
  section from `AGENTS.md`. Do not restore it automatically or add replacement
  boilerplate. This decision is resolved.
- `91b5c87`: committed this checkpoint and workflow options.
- `baa37d7`: committed the recovered historical validation results.
- Structured product extraction, text-only MCP raw-page reconstruction, saved-SKU
  forwarding, per-page reader cleanup, fixtures/tests, README changes, and a pinned
  direct `linkedom` dependency with lockfile update are included in the extraction
  milestone commit containing this checkpoint. The user approved committing it.
- Remote/push state was not checked. No infrastructure was changed.

## Verified versus uncertain

Inspected all eight saved job databases read-only under
`~/.local/state/benstack-sku-worker/jobs/`, without reading credentials or making
live requests. Transcripts from October 20-21 establish:

- Two initial jobs settled as `unanswered`: `gpt-5.4` was rejected for ChatGPT
  account access. Six later jobs settled as `done` with saved answers using
  `gpt-6.1-sol`. Completion does not mean the proposed identification was verified.
- Earlier Exa-backed runs proposed Bounce Outdoor Fresh dryer sheets, 2 x 160
  sheets (SKU `1572430`), and Ivory Snow fragrance-free detergent, 4.55 L / 113
  loads (`1653524`). Other Exa runs had weaker or unresolved evidence.
- Two historical jobs (`a3763fe7-8915-44d9-89ea-794dafdfda59` and
  `93dd5be0-45d4-450d-82d6-42b022e3d821`) successfully used OpenAI hosted search
  on Same-Day and Business Centre after Costco.ca returned no supported citation.
  Both proposed green onions, 907 g, for `3028018`, with moderate confidence.
- Live inference, hosted search, page fetching, and saved-answer persistence
  therefore worked in those historical runs. Direct page extraction sometimes
  returned boilerplate or omitted SKU/size headers; the final answers distinguished
  hosted-search claims from independently fetched evidence.

Current-session results:

- User confirmed interrupt/resume had already worked in their prior manual test;
  this was not repeated live in this session.
- Comparing the exact same saved HTML before/after Readability reproduced lost
  SKU/product fields. Both tested pages contained JSON-LD Product data.
- Implemented one HTTP fetch per page, followed by bounded local extraction of
  JSON-LD Product fields and named Costco product-details/specifications sections.
  Product selection uses the saved job SKU; missing or conflicting evidence is not
  guessed or combined across products.
- The first fresh job (`f4536b53-3e88-43e4-9625-f3598ff5b370`) completed with only
  search-backed evidence because an incorrect MCP integration assumption broke
  direct fetching. Fixed it: the pinned library forwards text only, so complete
  raw bodies are reconstructed from validated local-memory continuation slices.
  Also fixed saved-SKU forwarding through the OpenAI search/page-reader wrapper.
- Real page-only fetches then recovered SKU/size/form for green onions and
  SKU/scent/2 x 160-sheet pack evidence for Bounce, without model/search requests.
- Fresh end-to-end job `206c1324-7a95-4637-92b3-d083edc18d2c` for `3028018`
  settled as `done`: directly fetched Business Centre evidence established exact
  SKU, Green Onions, 907 g / 2 lb, and whole form. The answer kept brand and
  pack/bunch count unresolved. Same-Day provided no structured product evidence.
- Read-only inspection of that job confirmed compact persisted fetch results
  (1,159 and 869 bytes), with no raw HTML. Each page-reader subprocess closes after
  extraction, releasing its raw-body memory. Full HTML is not sent to the model or
  saved in Durable's transcript.
- Type checking, all 29 offline tests, and `git diff --check` passed after the fix.
  Live research used ChatGPT/search allowance; do not describe this session as
  entirely offline.

Remaining limitations: Same-Day pages and pages without usable Product JSON-LD or
with changed section selectors can remain unresolved. MCP does not expose HTTP
status/MIME metadata; these are explicitly not independently verified. Validation
covers two live page examples and one successful post-fix end-to-end job, not broad
Costco coverage, hosting readiness, or production concurrency/resource management.

## Next action and why

**Agree whether to stop at this prototype milestone or scope broader SKU/Same-Day
coverage.** The user approved committing the extraction changes. All 29 offline
tests, type checking, and `git diff --check` passed again before committing; no
additional live validation was run. Do not repeat login/search or interrupt/resume
checks just to reconstruct progress.

Hosting is eventual intent, not implemented: resource limits,
durable persistence, recovery, and a suitable hosted authentication/access design
need separate planning. Do not automatically deploy or start more live requests.

## Useful references

- `apps/sku-worker/README.md`: setup, commands, tool boundaries, stop/resume,
  local state, verification, and prototype limitations.
- `apps/sku-worker/src/`: implementation.
- `apps/sku-worker/test/`: offline tests.
- `package.json`: root `sku` command.

## Boundaries

- Discuss before resuming implementation, changing infrastructure, or committing.
- Do not read credential files or login caches to reconstruct progress.
- Do not log into AWS or change the machine's AWS access setup as part of this
  work. Its separate documentation is in `~/.aws/README.md` and
  `~/.aws/read-only-credentials-research.md`; the broader credential-source audit
  remains pending.
- Live ChatGPT/search validation can consume account allowance. Agree on the
  scope first; never paste OAuth redirect URLs or tokens into chat or this note.

## Next-session prompt

> Read STATUS.md and apps/sku-worker/README.md, then inspect Git status and recent
> commits. Structured extraction is implemented and approved for commit; 29 offline
> tests and one fresh post-fix end-to-end job passed. User previously tested resume.
> Help choose the next milestone. Discuss before changing
> code, starting live requests, logging in, or committing. Do not automatically
> resume implementation or deploy.

## Stopping routine

Before ending a work session, ask: "Update our checkpoint for next time."

When updating this checkpoint:

- Update this same `STATUS.md`; do not create dated copies.
- Keep it a concise current checkpoint, not a growing activity log. Replace stale
  details and remove resolved questions.
- Update the date, goal, stopping point, verified results, remaining uncertainties,
  and next concrete action with its reason.
- Check current Git state. Distinguish observed results from assumptions; do not
  claim tests or live validations passed without evidence.
- Reference existing docs and commits instead of copying their contents.
- Preserve this routine and relevant boundaries so the next session can follow
  them too.
- Show a brief summary of the update and ask before committing.
