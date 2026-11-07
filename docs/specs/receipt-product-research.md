# Receipt-triggered product research and approval

Status: Phase 1 implementation authorized on 2026-11-07; deployment and paid calls remain gated.
Date: 2026-11-07
Baseline: SKU worker migration commit `0ce6189` (Pi Durable 1.5.0).

## 1. Goal and user experience

Uploading a receipt automatically starts background research for eligible unknown
Costco Canada products. The app presents evidence-backed proposals in an approval
inbox. Only an explicit authorized approval creates or changes approved product
metadata. Uploading, viewing, or chatting about a receipt never approves research.

```text
You upload receipts
        |
Import receipt + items + research request atomically
        |
        +------------------------------> Receipt is immediately usable
        |
Unknown eligible SKU?
   | no                 | yes
Use approved data       Reuse pending work or queue one job
                                |
                         Background research
                                |
                       Proposal / unresolved / failed
                                |
                         In-app review inbox
                           /             \
                      Approve           Reject / dismiss
                         |                    |
                 Approved product       No catalog change
                         |
              Enriched receipt display
              (original receipt unchanged)
```

No terminal command is needed in normal app use. Research may be delayed or paused
without blocking receipt access. The first release notifies through an in-app
badge/inbox, not email, SMS, or a requirement to leave a browser tab open.

## 2. Decisions to review once

These are recommended defaults, not claims of prior user approval. Unless changed
in spec review, implement these defaults rather than repeatedly reopening them.

| Decision | Recommended first-release behavior |
|---|---|
| Trigger | Automatically after successful import through either existing upload path |
| Scope | Costco Canada warehouse merchandise with an exact numeric item number |
| Missing data | No approved product identity for that organization and SKU |
| Research fields | Product name, brand, variant, quoted size and pack evidence |
| Approval | Organization owner/admin, explicit selected fields, no bulk approval |
| Ownership | Organization-scoped products, research, and review; no global sharing |
| Categories | Do not automatically edit the shared SKU-to-spending-category map |
| Existing receipts | No automatic historical backfill; later explicit bounded admin action |
| Notification | Persistent in-app review inbox and pending-count badge |
| Initial rollout | One allowlisted organization, one active research job globally |
| Queue | PostgreSQL job rows, committed with receipt import; no new SQS hop initially |
| Hosting | Dedicated single worker host with persistent local SQLite, described below |
| Provider | Explicitly configured paid/service credentials; never personal-plan fallback |
| Stale/failed work | Visible status and explicit re-research; no endless automatic retries |

Two owner decisions remain launch gates, not reasons to block offline implementation:
1. Select and fund the supported hosted reasoning/search provider account and models.
2. Approve a daily model/search spending limit and the infrastructure cost estimate.

Do not enable paid calls or deploy based solely on this document. If category
classification rather than product identity is the immediate priority, revise the
scope before implementation; it is a separate shared-data policy, not a hidden
side effect of approving a product name.

## 3. Verified current system

Repository inspection, not a live AWS deployment audit:

- `apps/web/src/routes/receipts.tsx`: normal upload uses a presigned S3 flow and
  polls receipt-import job status.
- `apps/server/src/modules/receipts/receipts.service.ts`: creates upload jobs and
  implements direct receipt insertion.
- `apps/receipt-processor/src/index.ts`: separate, substantially duplicated insertion
  logic handles S3 notifications delivered through SQS to Lambda.
- `apps/server/src/modules/receipts/receipts.routes.ts`: direct `/upload` is another
  import path; `apps/web/src/routes/receipts-upload.tsx` exposes it as a dev tool.
- `packages/db/src/schema/receipts.ts`: organization-scoped receipts and receipt
  items; item types distinguish merchandise, fuel, deposits, discounts, and fees.
- `packages/db/src/schema/categories.ts`: shared `reference.costco_item_category_map`
  and spending categories. There is no general product catalog schema or review inbox.
- `apps/server/src/modules/chats/chats.tools.ts`: category filtering reads that
  shared mapping; chat searches original receipt descriptions.
- `packages/auth/src/index.ts`: Better Auth sessions and organization membership.
  Current `orgMiddleware` chooses an active organization but is not sufficient
  proof of owner/admin permission or current membership for this new feature.
- `infra/`: Terraform manages the app, including alternative API/database modes
  and receipt SQS/Lambda processing. Configured resources are not proof of live state.
- `apps/sku-worker/`: local CLI with personal ChatGPT consent, two read-only Costco
  tools, SQLite persistence, safe progress, and evidence assessment. It does not
  currently enqueue work from receipts or publish structured catalog proposals.

Current insertion writes the receipt header before its child rows without a
per-receipt transaction. A later failure can leave a partial receipt that a retry
then skips as a duplicate. Fixing that import boundary is a prerequisite here.

## 4. Functional requirements

### 4.1 Eligibility and missing-data policy

Evaluate only committed lines with `type = item`, in supported Costco Canada
warehouse receipts, whose trimmed item number satisfies the existing SKU validator
(1-12 decimal digits). Preserve leading zeroes; never numeric-cast identifiers.
Validate country/merchant provenance from the supported import contract; do not
classify an arbitrary uploaded receipt as Canadian solely from a numeric SKU.

Fuel, discounts, deposits, eco fees, missing/invalid SKUs, and unsupported merchants
are excluded with a machine-readable reason. Never infer a SKU from a description,
URL product ID, parent adjustment, or a model guess.

For release one, an approved product with a name is a resolved identity. Missing
optional brand/size/pack fields do not repeatedly trigger jobs. Keep unknown fields
null and expose them as unknown. Owners can explicitly request more research.
A spending-category mapping alone does not count as a product identity.

### 4.2 Admission and deduplication

Business key: `(organization_id, merchant = costco, market = CA, sku)`.
Do not deduplicate across organizations, expose another organization's receipt
context, or treat a countryless SKU as globally unique.

In the per-receipt transaction:
1. Insert receipt header, item/tender/tax rows, or identify an existing duplicate.
2. Collect distinct eligible unknown product keys.
3. Reuse an approved product or existing queued/paused/running/awaiting-review request.
4. Otherwise insert one queued research request, plus receipt-item associations.
5. Commit all receipt data and admission rows together.

Enforce deduplication with database constraints and conflict handling, not a
check-then-insert application race. A partial unique constraint permits only one
active request per business key (`queued`, `paused`, `running`, or `awaiting_review`). Uploading the same SKU in simultaneous receipts,
retrying SQS delivery, or retrying an HTTP upload must not create duplicate work.

A rejected, unresolved, or failed outcome suppresses further automatic research
for that key for 30 days. After the cooldown, a new qualifying receipt may create
one new generation; an authorized explicit re-research can bypass the cooldown.
Awaiting-review proposals do not expire into automatic duplicate research.

Raw receipt validity is independent of research availability. Queue growth is
bounded and admission can create a visible `paused` request when disabled or over
quota. A worker/provider outage never turns a successfully imported receipt into
an import failure. If the database cannot atomically save an admission decision,
roll back that receipt and make the failure visible/retryable; never silently lose
an expected job. Existing receipt response fields remain compatible; add optional
research counts/status without redefining receipt-job `done` to mean research done.

Historical partial imports need an explicit diagnostic/repair path. Do not silently
rewrite old financial records or automatically research the entire history.

### 4.3 Worker execution

A dedicated hosted entry point polls queued PostgreSQL rows, claims a request,
creates/reopens the corresponding Pi Durable job, and publishes a terminal outcome.
The local CLI remains available and retains its separate login/no-fallback policy.

- Use a persisted request UUID as the stable Pi admission identity.
- Keep leases short and renewable; all claims/results use a claim generation token.
- Update results only while still owning the claim. An obsolete worker cannot
  publish a proposal after a newer generation, cancellation, or approval.
- Run one process globally and one SQLite owner per job. Use a host process lock
  and a dedicated PostgreSQL connection for the worker ownership/advisory lock.
- Stop starting external calls on loss of ownership; abort bounded in-flight work.
  Lease expiry alone does not prove the previous process is dead. Fence/stop the
  old process/host before opening its SQLite files from a replacement.
- Persist job outcome and proposal before marking the application request complete.
  If publication fails, retry idempotent publication from the saved answer; do not
  repeat model research merely because PostgreSQL was briefly unavailable.
- No receipt-writing, shell, deployment, approval, or category-changing tools are
  offered to the research model.

Pi Durable is not the queue and PostgreSQL is not a substitute for its transcript:

```text
PostgreSQL                         Worker persistent disk
+---------------------------+      +-----------------------------+
| Receipt and item records  |      | Pi Durable SQLite per job   |
| Queued requests + leases  | ---> | Model/tool checkpoints      |
| Proposals and decisions   | <--- | Committed answer + evidence |
| Approved product versions |      +-----------------------------+
+---------------------------+
```

### 4.4 Structured proposals and evidence

Do not parse a catalog update out of free-form answer prose. Introduce a versioned,
runtime-validated result contract alongside the human-readable answer. The worker
may emit candidate fields, but deterministic validation checks identity, lengths,
allowed fields, and source references before a proposal becomes reviewable.

A result contains:
- Request ID, schema/rules version, exact business key, model/config version,
  execution timestamps, saved answer ID, and outcome.
- Candidate `name`, nullable `brand` and `variant`, quoted `sizeText`, and nullable
  `packText`. Preserve estimates/conflicts as quotes; do not silently normalize
  them into exact quantities or assume missing pack counts.
- Per-field evidence references: supported source URL, observed timestamp, source
  class (`hosted_search` or `direct_page`), excerpt/structured field, and uncertainty.
- Existing evidence summary (`direct_sku_match`, `search_only`, `unresolved`) and
  fixed review flags. Confidence is advisory, not approval or correctness proof.

Reuse the extractor and `assessEvidence`; do not claim it validates pack counts or
all final-answer statements. Any proposed field lacking traceable support stays
unknown or is withheld. Conflicting values are displayed side-by-side, not merged.
No current stock/price/Newfoundland availability claims; no postal code/login exists.

Keep execution success separate from useful evidence: a saved answer can produce
`unresolved`, and a finished tool can contain an error. Invalid result contracts
produce a visible failure/unresolved outcome, never an approved product.

Search-only candidates can be reviewed, but acceptance requires an extra explicit
acknowledgment of weak identity evidence and is recorded as such. A proposal with
no supported exact-SKU identity claim cannot be approved as a product match.
Direct-page SKU evidence also never bypasses human review.

### 4.5 Approval, rejection, and catalog behavior

All reads require current organization membership. Approval/rejection/re-research
require current owner/admin membership checked server-side for every action.
Derive organization from verified membership/session, not a caller-supplied org ID.
Cross-organization IDs return not-found without leaking resource existence.

Approval submits proposal revision, expected approved-product version, explicit
selected fields, and a decision idempotency key. In one database transaction:
- Confirm request/proposal is current and undecided, and versions match.
- Validate selected fields against that proposal; arbitrary client/model properties
  cannot write through to the catalog.
- Create/update the organization-scoped approved product version.
- Append immutable decision provenance (actor, time, selected fields, before/after,
  evidence references, weak-evidence acknowledgment where applicable).
- Mark the proposal approved and update its request state.

Repeated identical approval returns the prior result without another write.
Conflicting approval/rejection or stale catalog versions return `409` for refresh.
Existing approved values are not silently overwritten by later research or upload.
Reject requires a reason; rejected fields never reach the approved catalog.
Manual unsupported corrections are outside this approval endpoint and cannot be
misrepresented as model-evidenced data. Re-research creates a new generation,
retaining the previous result/decision history.

Receipt descriptions, purchase dates, prices, taxes, quantities, and totals remain
immutable through enrichment. Read APIs may join the approved product by scoped
business key to provide a separate display name/metadata. Historical receipts can
then display approved metadata without rewriting their financial record. Proposals
are visibly unapproved and never become chat/catalog facts by being saved.

Do not change shared category mappings, existing category-based totals, or chat
search semantics in this release. Correcting an approved product later creates a
new audited version; restoring the prior version is an authorized audited action,
not an undocumented SQL edit.

### 4.6 Review UI and notification

Add `/product-research` and a navigation badge scoped to the current organization.
Tabs: awaiting review, active/paused, unresolved/failed, and decision history.
Receipt lines link to the relevant request or approved metadata. Upload completion
says, for example, `12 receipts imported; 3 products queued for research` and makes
clear that these are separate workflows.

```text
Product research                              [3 awaiting review]
+--------------------------------------------------------------+
| SKU 1572430 | Proposed Bounce Outdoor Fresh                   |
| Receipt text: original abbreviation                          |
| Evidence: direct SKU match | Pack count needs human review    |
|                                                              |
| Field       Current       Proposed          Source            |
| Name        Unknown       Bounce ...        [Costco page]     |
| Size/pack   Unknown       "2 x 160 ..."      [quoted section]  |
| Brand       Unknown       Unknown           --                |
|                                                              |
| [Select supported fields] [Approve selected] [Reject]          |
+--------------------------------------------------------------+
```

Render all source/model text as untrusted text, never raw HTML. Source links must
pass the existing supported-host HTTPS checks; external links use safe rel values.
Show missing/conflicting fields prominently. Disable decisions while submitting,
but rely on server idempotency rather than button state for correctness. Invalidate
organization-scoped caches on decisions and clear them when switching organizations.
Poll while viewing active work; persist inbox/count state in PostgreSQL so no open
browser is required to receive a result. Completion must not be a transient toast
that disappears before the user returns.

## 5. Proposed data model and API

Names below are implementation targets, not existing tables.

| Entity | Required purpose and constraints |
|---|---|
| `product_identity` | UUID plus unique organization/merchant/market/SKU business key |
| `approved_product` | Current approved fields/version; unique identity; no proposal data in reads |
| `product_research_request` | Identity, generation, state, reason, retry/cooldown times, claim token/lease, Pi job reference, config and timestamps; partial unique active identity |
| `product_research_receipt_item` | Request/item association; unique pair; scoped receipt ownership checked |
| `product_research_proposal` | Immutable revision, validated candidates/evidence, result version, answer reference, evidence flags |
| `product_research_decision` | Immutable actor/action/idempotency key, before/after, selected fields and evidence acknowledgment |
| `product_research_daily_usage` | Atomic job admission/reservations and measured provider usage per org/global day |

Request transitions:

```text
queued --> running --> awaiting_review --> approved
   |           |              |
 paused        +--> unresolved +---------> rejected
   |           +--> failed
 queued

failed / unresolved / rejected -- explicit re-research --> new queued generation
```

`running` with an expired lease is inspected for recovery, not blindly reset.
Infrastructure interruption before an external request can resume the same work.
With current no-model-retry policy, a hard-crashed model request may already have
settled `interrupted`: publish `failed`, do not invent a successful resume. A
crash-limited tool may still lead to an answer; classify its evidence honestly.

Proposed routes, registered under the existing Hono app:
- `GET /api/product-research?state=...&cursor=...` - bounded organization list/counts.
- `GET /api/product-research/:id` - proposal, safe evidence, linked receipt context.
- `POST /api/product-research/:id/approve` - explicit fields and versioned decision.
- `POST /api/product-research/:id/reject` - reason and versioned decision.
- `POST /api/product-research/:id/research-again` - owner/admin action with cost warning.
- `GET /api/receipts/:id` - additive approved metadata/research-status fields only.

All list APIs are paginated; all action payloads have runtime schemas, limits, and
CSRF/origin protections consistent with session-cookie authentication. No public
worker HTTP endpoint or ability to provide arbitrary search domains/prompts.

## 6. Production hosting, authentication, and limits

### Recommended low-volume architecture

Keep the existing S3 -> SQS -> receipt Lambda pipeline. Add no research SQS queue
initially: a PostgreSQL request row is both durable admission and the worker queue,
avoiding a database/message dual-write gap. Use short transactions and indexed
claims; never hold an import transaction during network research. If a later scale
phase introduces SQS, publish through a transactional outbox and keep DB dedupe.

Use one dedicated EC2 worker host, supervised by systemd, with a persistent,
encrypted EBS data volume for local Pi SQLite files and no inbound app/SSH ports.
Administer through Session Manager. Use IMDSv2 and least-privilege instance roles,
restricted database credentials, and explicit outbound networking for providers,
Costco fetching, and AWS management/telemetry. A public subnet alone does not give
a private-address-only process internet access; validate the actual egress design.

This is a deliberate single-worker pilot, not an HA service. It retains the
already-tested local SQLite backend rather than treating Lambda `/tmp`, Fargate
scratch space, or shared network filesystems as durable SQLite storage. Do not put
SQLite WAL files on EFS or S3 or copy an actively written database unsafely. EBS
data must survive instance termination; replacement requires stopping/fencing the
previous owner before attaching/opening it. Defer horizontal scaling and a custom
Pi storage backend until measured throughput requires them.

Use the existing Terraform ownership in `infra/`; do not introduce a second IaC
owner for these resources. No direct infrastructure creation is part of spec work.
Select instance sizing and estimate its cost after a bounded memory/CPU benchmark.
Test the worker DB adapter against both supported app DB modes; a long-lived
ownership lock requires a dedicated PostgreSQL connection, not the Neon HTTP client.

### Provider access

The local CLI uses personal ChatGPT plan consent; do not copy its credential file
to the host or silently use it for app users. Add an explicit service-auth adapter
using approved paid credentials and a compatible hosted-search API. Verify actual
model availability, request fields, billing, and hosting terms at implementation.
Do not assume local plan-specific Responses request shapes work unchanged with
service billing. Credentials are stored in managed secrets, never queue rows,
receipt payloads, model context, logs, or Git. No fallback to another account/key.

### Initial configurable limits

- Feature and live-provider switches default off; rollout requires an org allowlist.
- One global active research job; one per-SKU active request by DB constraint.
- Maximum 20 admitted new jobs per organization/day and 20 globally/day for pilot.
- At most 12 outer tool calls and 8 outer tool rounds per job.
- Five-minute execution slice, ten-minute cumulative active execution budget per job;
  queue waiting and human review time do not consume that execution budget.
- Preserve bounded page bodies/extracts and subprocess cleanup from the prototype.
- Set supported output/request limits for both reasoning and inner search calls;
  refuse enablement if the chosen adapter cannot bound its requests as designed.
- Provider auth/quota failures pause new paid work and show actionable status.
- Configure daily monetary admission limits and reserve a conservative per-job
  allowance before starting work; reconcile measured outer AND inner search usage.

These are admission and request controls, not an exactly-once billing guarantee or
a guaranteed hard dollar ceiling. In-flight requests, interrupted work and provider
metering delays can exceed estimates. AWS Budget alarms are alerts, not a spend
kill switch. Include infrastructure and network costs in the separate estimate.
A global pause stops new admissions/claims; urgent stop also cancels current work
and records that outcome rather than pretending it was only gracefully paused.

## 7. Reliability, privacy, and operations

- Admission, result publication, and approval are independently idempotent.
- Database unavailable: do not start research that cannot be owned/accounted for.
- Provider/page failure: surface failure or unresolved evidence; do not claim a
  product does not exist or retry indefinitely. Unexpected schema changes fail closed.
- Receipt Lambda validates bucket, exact key shape, job/org/key correspondence and
  supported input before import; key path alone is not trusted tenant authority.
- Models receive SKU and public product evidence only. No membership numbers,
  tender data, whole receipts, user emails, or receipt barcodes in prompts/search.
- Only the publishing/approval service has product mutation privileges; the model's
  tool boundary remains read-only. Logs omit raw credentials, prompts and page HTML.
- Deleting receipts removes their request associations. Cancel unpublished work
  with no remaining receipt associations unless an explicit admin request owns it.
  A worker cannot resurrect deleted tenant data. Organization deletion removes
  tenant research/products and schedules transcript/artifact deletion.
- Default retention: 30 days for terminal raw transcripts and rejected/unresolved
  research details; retain approved selected-field evidence/decision provenance
  while the approved product exists. Request tombstones retain only the key/state
  needed for cooldown. Backup deletion follows its documented expiry window.
- Back up PostgreSQL through its selected managed backend and Pi SQLite through
  SQLite's safe backup API, not a live bare-file copy. Encrypt artifacts and verify
  integrity before uploading a backup manifest. Backup credentials separately.
- Pilot target: hourly Pi backups, seven-day backup retention, RPO <= 1 hour and
  RTO <= 4 hours, demonstrated by a restore drill. Account for the selected DB
  backend's recovery capabilities rather than claiming these targets already hold.
- Restore PostgreSQL/application and Pi state coherently. If DB state says work ran
  but its transcript is missing/older, stop and mark recovery-needed; do not replay
  external requests from an empty job directory. Never downgrade 1.5.0-written
  state to 1.4.0 without an appropriate pre-upgrade backup.
- Monitor queue age, paused reasons, job duration/outcomes, lease loss, heartbeat,
  disk/memory, backup age, provider usage, and approval conflicts. Use request IDs,
  not receipt contents, as log correlation keys. Alert on worker outage, stale
  backups, provider auth/quota failure, and work stuck beyond its budget.

Document deploy/drain/restart, restore, credential rotation, provider outage,
re-research, deletion, and rollback runbooks before enabling automatic production
research. Read/approval remains usable when workers are paused.

## 8. Implementation sequence and ownership

1. **Import safety and shared admission**
   - Extract duplicated Costco types/classification/import logic into a shared
     package (proposed `packages/receipt-import`) usable by server and Lambda.
   - Introduce a transaction-capable adapter for each DB mode. Test real rollback
     of header/children/admission, not just a TypeScript cast to `NodePgDatabase`.
   - Harden input/tenant validation and duplicate import behavior. Add regression
     tests before removing duplicated code.
2. **Schema and queue policy**
   - Add Drizzle schema/migrations under `packages/db/src/schema` and
     `packages/db/src/migrations`; introduce scoped identities, queue, decisions,
     usage and active-request constraints. Reuse existing organization IDs.
   - Add shared admission policy used by both import entry points; feature off by
     default. No historical scan or modifications to reference category seeds.
3. **Hosted worker/result contract**
   - Extend `apps/sku-worker` with validated structured result and a service runner,
     dedicated provider auth, queue ownership, bounded usage, idempotent publishing,
     and explicit terminal/recovery semantics. Preserve the local CLI/tests.
4. **Review service and authorization**
   - Proposed `apps/server/src/modules/product-research/` and route registration
     in `apps/server/src/index.ts`. Add membership/role checks, validated action
     payloads, optimistic concurrency, auditing, and approved metadata joins.
5. **Review UI and receipt integration**
   - Add `apps/web/src/routes/product-research.tsx`, header badge, safe detail/field
     selection, receipt status links, and additive types in `receipts.tsx` and
     `receipts-upload.tsx`. Keep upload/import completion distinct from research.
6. **Infrastructure and staged pilot**
   - Add reviewed Terraform changes, service packaging, secrets integration,
     persistence/backups/alarms and runbooks. Validate both API/database modes
     without accidentally applying resources to both environments.
   - Obtain provider/budget approvals, run staged live acceptance with a bounded
     allowance, then enable one organization's receipt-triggered admission.

Do not skip directly from the current CLI to deployment. The queue/transaction,
structured proposal, and authorization boundaries are prerequisites.

## 9. Acceptance checklist

Automate these unless explicitly marked manual:

- [ ] A newly imported eligible unknown SKU queues one request without manual action
      through BOTH direct HTTP and S3/SQS/Lambda import paths.
- [ ] Receipt-header/child/admission rollback is atomic on injected failures in both
      DB modes; a later retry imports completely rather than skipping a partial header.
- [ ] Duplicate receipts, repeated SQS deliveries, concurrent uploads and repeated
      SKUs reuse work without another external request or duplicate proposal.
- [ ] Approved identity bypasses research; optional unknown fields do not loop;
      excluded lines and cooldowns behave as specified.
- [ ] Receipts remain usable while research is queued, paused, failed or unavailable.
- [ ] Process death, graceful deploy drain, expired claims and interrupted publication
      preserve identity/budgets and never permit two owners of one SQLite job.
- [ ] Lost/stale transcripts fail safely instead of silently restarting external work.
- [ ] Terminal model interruption and tool restart-limit outcomes follow 1.5.0
      behavior and produce accurate app statuses.
- [ ] Schema-invalid, mismatched, malicious or contradictory results cannot become
      silently approved fields; safe source links and plain-text rendering are tested.
- [ ] Inbox state survives browser closure; badges and counts are organization-scoped.
- [ ] Other organizations, stale sessions, non-members and non-admin members cannot
      read/decide protected work by guessing IDs or changing the active-org session.
- [ ] Approval is atomic/idempotent; conflicting concurrent decisions return `409`;
      original receipt values and shared category mappings remain unchanged.
- [ ] Only approved metadata appears as product facts in receipt read APIs; proposal
      text is not leaked into existing chat tools or aggregate category calculations.
- [ ] All request/usage caps, global pause, secret rotation, deletion and cooldown
      boundaries have deterministic tests with no live requests.
- [ ] **Manual staging:** complete a real receipt-upload -> research -> review ->
      approval flow, plus reject, unresolved, provider-outage and quota cases.
- [ ] **Manual recovery:** restore backups onto a replacement host and demonstrate
      single ownership, integrity, no duplicate approval and documented RPO/RTO.
- [ ] **Manual quality pilot:** review at least 20 varied SKUs including exact matches,
      Same-Day conflicting/estimated sizes, missing structured data and invalid
      numbers. Record evidence quality and per-job cost; no predetermined accuracy
      claim. Unsupported proposals must never be automatically applied.

Verification starting points (run against isolated test environments, not production):

```bash
bun run --cwd apps/sku-worker check-types
bun run --cwd apps/sku-worker test
bun run check-types
bun run build:lambda
bun run build
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

Add and document dedicated integration/UI test commands as those suites are built;
they do not currently exist for this feature. Migration generation/inspection is
part of implementation; no production `db:push`, migration, Terraform apply, live
login, or paid test is authorized by writing this spec.

## 10. Definition of done and exclusions

Done means an allowlisted user can upload a supported receipt, later see an
accurate proposal or explicit failure/unresolved status, approve selected supported
fields, and see approved metadata in the app without changing the underlying
receipt. The acceptance checks, funded provider access, operational limits,
monitoring and tested restoration must all be satisfied before production enablement.

Out of scope: automatic approvals, automatic catalog writes from model output,
shared/global product publishing, automatic spending-category changes, non-Costco
or non-Canadian research, PDF/OCR import expansion, current stock/pricing promises,
Costco login/browser automation, unbounded historical backfill, multi-worker/HA
execution, external notifications, and unrelated chat or infrastructure rewrites.

## References

- [Local worker usage and limitations](../../apps/sku-worker/README.md)
- [Pi Durable 1.5.0 changelog](https://github.com/earendil-works/pi/blob/v1.5.0/packages/durable/CHANGELOG.md)
- [AWS EC2 security best practices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security.html)
- [EBS persistence configuration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ec2-instance-ebs.html)

Provider contracts and AWS implementation details must be rechecked against current
primary documentation when implementing. This spec creates no cloud resources,
changes no application behavior, and does not establish production readiness.
