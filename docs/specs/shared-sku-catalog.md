# Shared SKU catalog and system-admin research

Status: Agreed design; specification only. Implementation has not started.
Date: 2026-11-08
Execution checkpoint: [STATUS.md](../../STATUS.md)

## 1. Authority, scope and approvals

This is the source of truth for the next product-research refactor. It supersedes
[receipt-product-research.md](receipt-product-research.md) where that document
requires organization-owned products/research, organization-owner review, ordinary
user research navigation, tenant-cascading catalog deletion, or a migration-first
schema workflow. The earlier spec remains useful historical context, not proof of
current implementation or deployment status.

The user agreed to:
- One shared approved catalog across users, keyed by merchant + market + exact SKU.
- Private organization-owned receipts with original descriptions and financial facts preserved.
- One global research pipeline for an unknown product, not one pipeline per organization.
- Research/review as a system-admin tool, not an ordinary user-facing feature.
- Explicit human system-admin approval for each new identification initially.
- Approved metadata appearing automatically on both existing and future eligible receipts.
- Catalog knowledge surviving receipt, user and organization deletion.
- Expand-and-contract using this project's **Drizzle `db:push` workflow**.
- Deferring detailed token/cost accounting until an API-key version, while retaining
  sequential execution, deduplication, saved-result reuse, bounded execution and a pause switch.

Writing this spec does NOT authorize schema pushes, backfills, data deletion,
production access/deployment, admin-role grants, provider changes, or new live
research. Confirm the scope of a subsequent implementation request before those
operations. Never use this spec to restart or drain the legacy research backlog.

## 2. Named components and infrastructure

Use these names in discussions and handoffs:

| Name | Meaning |
|---|---|
| Web App | Existing browser frontend; receipt upload and approved enrichment |
| App API | Existing backend; private receipt operations and protected admin APIs |
| Admin Tools | System-admin-only area of the same app, not necessarily a separate deployment |
| Research Worker | Existing coordinator + Node/Pi Durable process, treated as one worker service |
| Dev Database | Neon `ben-local` branch |
| Production Database | Neon `main` branch; separate target, not verified by a dev rehearsal |
| Shared Catalog | Global approved product knowledge within an environment, not shared between dev and prod |

No second research service, new queue infrastructure or new database project is
required by this refactor. PostgreSQL remains the durable request queue. Hosting
or deployment of the Research Worker is separate work.

### Diagram A: current ownership (to replace)

```text
Org A private receipts                 Org B private receipts
          |                                      |
Org A product identity                 Org B product identity
          |                                      |
Org A research/approval                Org B research/approval
          |                                      |
Org A approved metadata                Org B approved metadata
```

### Diagram B: target infrastructure

```text
Regular user browser                 System-admin browser
          |                                   |
          +--------------+--------------------+
                         v
                  [ WEB APP ]
                  User UI / Admin Tools
                         |
                         v
                  [ APP API ]
                    |     |
         private    |     | system-admin authorization
         receipt    |     | on EVERY research operation
         access     v     v
              [ DATABASE, SAME ENVIRONMENT ]
              |                           |
       Private receipt tables       Shared Catalog
              |                     Research queue
              +-- eligible link --> Proposals / decisions
                                          ^
                                          |
                                 [ RESEARCH WORKER ]
                                   |             |
                                   v             v
                              OpenAI model     Costco
                              + hosted search  Canada pages
                                   |
                           Local SQLite + saved exports
```

Development currently runs Web App, App API and Research Worker on the dev server,
with Dev Database on Neon. Production infrastructure is not changed by this spec.
Catalog permissions must not implicitly grant access to private receipts.

## 3. Current implementation and reusable work

The current working tree is largely uncommitted. Inspect it before editing; do
not reset, replace or bulk-commit unrelated work. See STATUS.md for actual process
and database checkpoints rather than assuming old commands still run.

Reusable foundations:
- Shared transactional receipt import for direct API and S3/SQS processing.
- Runtime-validated, exact-SKU evidence contracts; original receipt facts kept separate.
- Pi Durable SQLite state and saved structured result before publication.
- Sequential queue claims, fencing/leases, no automatic inference restart,
  bounded publication-only retries and explicit selected-field approval/audit.
- Offline integration, native PostgreSQL and disposable browser test infrastructure.

Ownership assumptions that MUST change:
- `product_identity` includes organization ownership and a tenant business key.
- Research reads/actions authorize organization membership/owner roles.
- Worker claims/exports include organization identity and require owner membership.
- Receipt deletion can cancel orphaned tenant research; org deletion cascades identity data.
- Ordinary navigation, receipt lines and upload messages expose research operations.

Observed live dev examples, not global catalog approvals:
- SKU 118219: Natrel Salted Butter, 454 g; user approved name/brand in the legacy flow.
- SKU 1218213: Dempster's 10-in White Tortillas, pack of 18; UI-queued automatic
  research published awaiting_review. Worker stopped at its one-job cap.
- Tortilla run recorded 5,989 main-model tokens, four model responses, three
  search-tool calls, one page-fetch call, about 72 seconds and one tool error.
  Hosted-search model usage was NOT captured; this is not a complete token total
  or a measurement of remaining ChatGPT plan allowance.

Missing separate size/brand/pack extraction and automatic usage-report generation
are separate improvements, not prerequisites for the ownership refactor. Do not
rerun research just to change metadata shape or inspect usage.

## 4. Data boundaries and target model

### Diagram C: private facts versus shared knowledge

```text
PRIVATE                                  SHARED
Organization
    |
receipt header                            Catalog identity
    |                                    (costco, CA, exact SKU)
receipt item ---- verified association ----------|
    |                                           +-- Current approved fields/version
    +-- Original description                    +-- Request generations
    +-- Original SKU text                       |     +-- Proposal + public evidence
    +-- Quantity / price / tax                  |     +-- Fenced execution state
                                                +-- Admin decisions/provenance
```

A shared key is `(merchant = costco, market = CA, sku)` for the first release.
Preserve leading zeroes; do not numeric-cast identifiers. Do not merge Canadian
and US identities, infer a product from a URL's internal product ID, or silently
resolve SKU reuse/contradictory products. Conflicts require admin review; temporal
SKU/version modeling beyond approved revision history is deferred.

Prefer additive shared tables and new associations over in-place removal of
organization ownership from the existing tables. Target names below are proposed
implementation names; finalize them in Phase 1 and record the choice once.

| Proposed entity | Required invariant |
|---|---|
| `catalog_product` | UUID, unique merchant/market/SKU; no owning organization |
| `catalog_approved_product` | Current approved fields/version for one product |
| `catalog_research_request` | Product + generation, state, lease/token, cooldown and durable job identity |
| `catalog_research_proposal` | Immutable validated evidence/result for a request |
| `catalog_research_decision` | Immutable admin actor, action, selected fields, before/after and idempotency |
| `receipt_item_catalog` | Private receipt-item association to a verified catalog identity; one per item |
| Legacy-to-global mapping | Resumable mapping of legacy identities/requests/decisions; preserve provenance and flag conflicts |
| Admission accounting | Global new-job accounting plus private uploader abuse controls; not monetary billing |

Enforce one active request per shared product in the database, including paused,
queued, running and awaiting_review states. Preserve latest-generation checks,
optimistic approved-version checks and action idempotency globally.

Receipt associations may cascade when a receipt is deleted. Shared catalog rows,
research and decisions must NOT reference an organization with cascading ownership.
Deleting an admin account may anonymize/null its actor reference but must not erase
the decision. Shared data must contain no receipt barcodes, memberships, prices,
tenders, user emails, purchase dates or private receipt payloads. Do not expose
contributing user/org identities in the catalog or review DTOs.

Keep the existing shared spending-category map independent. Research approval
must not change categories, totals, historical spending or unrelated chat behavior.

## 5. Import, deduplication and receipt reads

### Diagram D: admission once across users

```text
Eligible receipt item committed in import transaction
                         |
            Upsert shared merchant/market/SKU
                         |
              Approved product already exists?
                  /                     \
                yes                     no
                 |                       |
          Link receipt item       Active request exists?
                 |                  /             \
                 |                yes             no
                 |                 |               |
                 |            Reuse request    Check admission
                 |                                 |
                 |                         queue / pause / capacity reason
                 +---------------------+-----------+
                                       |
                           Receipt immediately usable
```

Requirements:
1. Retain eligibility rules for supported Costco Canadian warehouse merchandise,
   exact 1-12 digit SKU, country/province provenance, item type and contradictory
   market exclusions. Matching SKU digits alone is never enough.
2. Both import entrypoints use the same shared-key lookup, deduplication and
   transactional association logic. Concurrency across two organizations must
   produce one identity/active request, not check-then-insert races.
3. An approved name resolves automatic identification. Missing optional fields
   do not repeatedly trigger work. Existing active work is reused before reserving
   another global admission slot.
4. Retain default-off admission, global capacity bounds, cooldowns and meaningful
   exclusion/pause reasons. Proposed initial cooldown remains 30 days for failed,
   rejected or unresolved work; only a new qualifying upload or explicit admin
   action can create the next generation under policy. Never poll-requeue failures.
5. Keep per-uploader limits as abuse controls, not product ownership. Reusing an
   already-approved product or global active request must not reserve another
   research job. A blocked uploader must not prevent other users from reading
   already-approved knowledge. Private import success remains independent of
   research capacity; actual transactional DB write failures still roll back.
6. Receipt reads must FIRST enforce caller ownership of the receipt, then join
   approved shared metadata through a verified association. Never remove private
   receipt predicates while removing organization predicates from product lookup.
7. Normal read DTOs contain approved metadata only, not proposals, worker errors,
   other users' context or admin actions. Preserve original description and prices.

Approved corrections affect every linked eligible old/new receipt at read time,
without rewriting financial data. Backfill historical associations in explicit,
bounded, resumable batches. Use trusted persisted eligibility/provenance; if an
old record cannot establish merchant/market safely, leave it unassociated and
report why. Do not blindly backfill every historical numeric SKU or enqueue an
entire receipt history as a side effect of this refactor.

## 6. System-admin authority and user experience

An organization owner/admin is NOT a system admin. Add one explicit server-side
system-admin check shared by admin APIs and worker operations. Prefer the existing
persisted Better Auth global role (`user.role`) if its semantics and validation are
confirmed; otherwise stop and document a dedicated role design before proceeding.
Read authoritative current state, deny banned/removed/demoted actors, and do not
trust client-supplied roles or a stale client UI flag. The initial system-admin
assignment requires explicit user confirmation; never auto-promote all org owners,
allowlisted emails or the currently signed-in user.

Proposed admin routes:
- UI: `/admin/product-research` and catalog management within the same protected area.
- API: `/api/admin/product-research` list/detail/approve/reject/research-again.
- Ordinary receipt APIs remain organization-scoped and return approved enrichment.

Every admin list/detail/action/count route must enforce system authority. Ordinary
users, including org owners, cannot enumerate research or request paid work via
old URLs, direct API calls or crafted IDs. Explicitly retire/block legacy research
routes at cutover; redirects and hidden navigation alone are insufficient.

Admin approval retains selected-field validation, proposal/catalog versions,
immutable audit and idempotency. Reject requires a reason. Re-research is an explicit
allowance-consuming admin action with a new generation where appropriate. Legacy
owner decisions are historical evidence, NOT automatically trusted global decisions.

### Diagram E: interfaces

```text
REGULAR WEB APP                  SYSTEM ADMIN TOOLS
Receipts                         Global research queue/counts
Upload                           Source evidence and uncertainties
Approved product display         Approve / reject selected fields
Original receipt text            Catalog corrections / explicit re-research

No research badge, queue         No default browsing of private receipts,
controls or proposal links.      uploader identity or purchase history.
```

Remove ordinary-user research navigation/badges, receipt research links and
research-operation instructions from upload completion. User upload feedback
reports imported/skipped/failed receipts; product processing is background system
work. Admin review should not require choosing an active organization. Keep safe
text rendering, supported HTTPS sources, pagination, polling and mutation feedback.
Catalog-admin status does not grant unrelated private-receipt access.

## 7. Research Worker and deletion semantics

Refactor request/claim/export identity to shared product + request UUID + generation
and fencing token, not tenant ownership. Claims remain global single-active and
results must match exact merchant/market/SKU/product/request. Preserve the result
schema's evidence validation; extend/version the envelope only where required.
Models still receive exact SKU and public product evidence only.

Maintain separate coordinator/Node process responsibilities and credential isolation.
Current explicitly consented dev ChatGPT plan support remains allowed; no API-key
or personal Pi/Codex fallback. Default finite one-job process cap and existing
pause/time/turn/tool safeguards remain. Do not silently turn on automatic process
restarts or reclaim expired running jobs. Retry publication of saved results only;
failed/interrupted/unknown execution needs explicit operator inspection.

Legacy SQLite/JSON is bound to organization/request identities today. Do not
rewrite completed transcripts, forge a new shared identity around an old export,
or reopen an old job to regenerate data. Preserve legacy artifact references and
provenance. A trusted conversion must validate product key and source identity,
record mapping, and never invoke a model. New requests need unambiguous new identities.

Deleting private receipts removes links, not shared catalog/research. Remove the
current dependency on an uploader/receipt still existing before global publication.
A global system-owned request has an independent lifecycle; it may finish after
its originating receipt is deleted without recreating that receipt. Explicit
system-admin cancellation must still fence publication. Retention/cleanup of raw
artifacts is a separate policy; independent lifetime does not mean indefinite raw
transcript retention or deletion of audit history by default.

## 8. Expand-and-contract and existing data

### Diagram F: rollout (dev first; production separately authorized)

```text
Inventory + pause legacy worker
             |
Expand shared schema + authorization helpers
             |
Shadow associations / conversion rehearsal (NO second live queue)
             |
Backfill verified links + stage legacy evidence/conflicts
             |
Switch admin APIs/UI + global imports/worker + approved reads
             |
Verify cross-user behavior with fake providers, then an authorized live pilot
             |
Contract legacy structures later, under separate reviewed removal
```

Operational rules:
- Read AGENTS.md. Use reviewed Drizzle `db:push`, not a migration-first workflow.
  Inspect wrapper setup scripts and proposed SQL; do not invent unsupported dry-run
  flags, invoke `--force`, or blindly accept destructive prompts.
- Before any persistent schema operation, confirm exact target/branch, take a
  private backup and prove a restore into an isolated copy. Compare actual schema,
  constraints and data, not migration ledger entries alone.
- Prefer dev `ben-local`; production `main` requires its own schema preflight,
  backup, rollout approval and deployment coordination. Current workflows can
  auto-deploy/use db:push, so merging is not a substitute for rollout planning.
- Pause/inspect legacy workers before conversion. Do not have org-scoped and global
  workers consuming two queues for the same product. Old CLI paths must not be
  capable of silently restarting legacy work after cutover.
- Expand only initially; keep legacy tables/data for rollback and comparison. Do
  not drop org columns/tables to force a unique global key over unresolved duplicates.
- Build deterministic mapping and conversion reports with resumable checkpoints.
  Re-running conversion must not duplicate products, jobs, decisions or links.
- Multiple legacy identities for a key collapse to one candidate global identity.
  Conflicting names/fields/evidence remain explicit conflicts. Never select the
  newest row or one organization's approval silently as global truth.
- Stage legacy approved evidence for a NEW system-admin confirmation without new
  inference. Preserve its original actor/scope/history. Until globally approved,
  it must not appear as approved shared metadata to other users.
- At the read cutover, unapproved/conflicted shared products fall back to original
  receipt text. Never fall back to unreviewed proposals or another tenant's legacy data.
- Changing reads/linkage must not call providers. Historical linking has a separate
  explicit research-enqueue switch, off for the backfill.
- Before cutover, rollback can stop new writes/claims and restore old code paths
  while retaining additive shared data. After global decisions/new writes, rollback
  needs a reviewed data/compatibility plan; do not restore an old dump over newer
  user receipts or pretend global decisions are equivalent to org approvals.

## 9. Work packages and stopping points

All phases below are NOT STARTED. Each implementation run should complete one
bounded package or leave a precise checkpoint; do not push through a blocked
permission, destructive SQL diff or unresolved mapping decision.

| Phase | Deliverable | Exit / stopping condition |
|---|---|---|
| 0. Inventory and freeze | Confirm target, worker state, actual schemas/counts, legacy duplicates and current role model; record proposed names/flags | No provider calls; target and initial admin bootstrap decision known; unfinished jobs fenced/inspected before touching their ownership |
| 1. Expand foundation | Additive Drizzle shared schema, constraints/associations, system-admin authorization and isolated fixtures | Reviewed schema diff + restore-copy rehearsal; private data unchanged; persistent push separately confirmed |
| 2. Global engine | Shared admission/quotas, global services and worker claims/publication; preserve offline gates and old artifact provenance | Native PG proves two-org dedupe, fenced execution, cancellation and no inference replay; legacy worker cannot run alongside the new queue |
| 3. Admin/user boundary | Protected admin routes/UI; remove ordinary research navigation/actions/status payloads | Direct non-admin API/URL attempts denied, including org owners; admin review needs no active org; receipt ownership tests pass |
| 4. Conversion/backfill | Idempotent legacy mapping and bounded eligible receipt-link backfill, conflict/evidence staging | Rehearsal reports counts/checksums, conflicts/unmapped rows and zero provider calls; actual dev conversion separately confirmed |
| 5. Dev cutover | Switch global writes/reads/worker; system-admin confirmation of staged knowledge; one explicitly authorized live flow if needed | All automated checks and manual two-user privacy/enrichment checks pass; agreed rollback checkpoint recorded |
| 6. Later contract | Remove obsolete code/tables/flags only when no readers/writers/artifacts depend on them | Separate reviewed destructive change + backup; never implicit in a cleanup or this spec |

Production rollout is not a phase to execute automatically. It needs explicit
approval and the separate deployment/service/provider/backup considerations.
Detailed API-key cost reservations and automatic recovery remain separate work,
not a reason to redo successful research or stall offline ownership work.

## 10. Acceptance checklist

Automate with fixtures, not live providers, unless marked manual:
- [ ] Two users in different orgs import the same eligible SKU concurrently: one
      shared identity and one active request; independent private receipt rows.
- [ ] Direct import and receipt-processor paths share admission semantics and
      transactional rollback; retries skip only complete duplicate receipts.
- [ ] Leading zeroes, foreign/unknown market, fuel/adjustment and unsupported-line
      checks remain correct; SKU digits alone never produce shared enrichment.
- [ ] Approved catalog lookup avoids new research across orgs; missing optional
      fields, duplicate uploads and awaiting-review results do not loop.
- [ ] Global admission/cooldown/capacity and per-uploader abuse controls do not
      accidentally recreate tenant-owned products or reserve duplicate paid jobs.
- [ ] System admin can operate research with no active organization; normal users,
      org owners and demoted/banned/stale actors cannot list/read/decide/retry it.
- [ ] Old research endpoints/URLs cannot bypass the new boundary; ordinary user
      DTOs/nav/receipt rows do not leak proposal, worker or private contributor data.
- [ ] System-admin catalog access does not allow reading another user's receipts.
- [ ] An admin's approval enriches both users' eligible receipts, including safely
      linked historical ones, without changing original row content or finances.
- [ ] Approval/rejection/version conflicts remain atomic, audited and idempotent;
      legacy org approval never silently becomes a global decision.
- [ ] Deleting one or all contributing receipts/users/orgs leaves shared products,
      audit and system-owned research intact; publication cannot resurrect receipts.
- [ ] Explicit admin cancellation fences stale worker publication.
- [ ] Concurrent workers, restart, lease expiry, failed inference and uncertain
      publication do not trigger duplicate research; saved output can be republished
      idempotently without another model/search request.
- [ ] Legacy artifacts/mapping reject foreign key/SKU/generation mismatches and
      preserve source provenance without rewriting SQLite or invoking inference.
- [ ] Conversion/backfill is resumable/idempotent; conflicts and unsafe legacy
      eligibility are reported, not silently guessed; categories are unchanged.
- [ ] **Manual dev:** one global approval visibly enriches two users' private
      receipts while each remains unable to access the other's data or admin tools.
- [ ] **Manual cutover:** verify reviewed db:push/restore-copy results and stopped
      legacy worker; record active flags/processes, remaining limits and rollback.

Validation starting points (inspect package scripts before running):

```bash
bun run --cwd packages/receipt-import test
bun run --cwd packages/product-research test
bun run --cwd apps/sku-worker test
bun run --cwd apps/web test:research
bun run --cwd apps/research-demo test
bun run test:research-browser
bun run check-types
bun run build:lambda
bun run build
```

Run database integration tests only on disposable local test databases; their setup
can drop schemas. Never pass ben-local/main as a destructive test backend. Add new
shared-catalog fixtures and native PostgreSQL cases rather than relabeling old
tenant-isolation tests as obsolete; private receipt isolation still must hold.

## 11. Decisions still requiring confirmation

Do not reopen the agreed shared/private/admin boundaries. These implementation
choices remain to be settled and recorded once:
1. Exact initial system-admin account and authorized bootstrap method. Verify the
   existing global role mechanism before granting anything.
2. Final additive table names, conversion mapping shape, cutover flags and batch
   sizing after Phase 0 inventory. Never equate a guessed ledger with actual schema.
3. Resolution of conflicting legacy identifications and insufficient historical
   merchant/market provenance; this may require human review, not another model run.
4. Production worker hosting, provider/service credentials, artifact retention and
   API-key accounting/recovery when production rollout is actually requested.

## 12. Cross-agent handoff contract

At the start of every run:
1. Read AGENTS.md, this spec and the newest STATUS.md checkpoint.
2. Check git status and existing uncommitted work. Verify runtime/database targets
   afresh; old terminal IDs and URLs are historical observations, not guarantees.
3. State the chosen phase, scope and forbidden side effects. Check required backup,
   role and live-call approvals before acting. Use fake providers for automated tests.

At the end of every run, update STATUS.md with:
- Phase completed/in progress, decisions confirmed and exact next bounded action.
- Files/code paths changed and any feature flags, DB pushes, backfills or role grants
  actually performed (target and scope; no credentials).
- Commands/checks run and observed results, including failures, skipped tests and
  limits. Distinguish local/native/CI/browser/live verification.
- Worker state, pending/running work, mapping conflicts, backup/artifact locations
  and recovery/rollback notes. Do not restart research to reconstruct a checkpoint.

Do not mark a phase or acceptance item complete without evidence. Spec creation is
complete; shared-catalog implementation begins at Phase 0 only when requested.
