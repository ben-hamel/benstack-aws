# Product research: offline execution, proposals, and review

Implements the application boundary in
[the production specification](../../docs/specs/receipt-product-research.md).
**No paid executor, hosted worker process, deployment or production migration is enabled.**

## Implemented flow

```text
Receipt import -> scoped request (default paused)
                         |
             explicit offline runner injection
                         |
       Pi Durable + faux model + fixture page evidence
                         |
          validated, persisted structured result
                         |
       proposal / unresolved / visible failure
                         |
        organization review inbox + safe quotes
                  /                 \
          approve fields          reject
                |
     versioned approved product + audit decision
                |
     separate receipt display metadata (no financial edits)
```

- `contracts.ts` is browser-safe and shared with the SKU worker. It validates SKU,
  field/source references, exact quoted values, source-host HTTPS restrictions,
  result bounds and actions. A valid contract is NOT proof the source is correct.
- `queue.ts` provides explicit `claimNext`, renewal, publication, failure and
  `runNext` functions. There is no automatic startup or live-provider entry point.
  The runner requires `enabled: true`, an organization allowlist and an injected
  offline executor. Paid execution is rejected, not silently routed to personal auth.
- Claims are globally single-active and fenced by a random token. Expired running
  jobs are NOT automatically reclaimed or restarted. Stop/fence the old host and
  inspect the saved transcript before any recovery. A timeout/ownership loss
  cooperatively aborts the executor; this is not an OS-level resource sandbox.
- Publication is atomic/idempotent by request and canonical result digest. A DB
  publication failure leaves the claim for saved-result retry, not repeat inference.
  Invalid executor contracts become failed work. No model tool can call approval.
- The SKU worker's `offlineDurableExecutor` uses explicit private state, faux models
  and injected fixture web access. `openJob().result()` constructs candidates from
  committed direct-page evidence, NOT final-answer prose, then persists that result.
  `readSaved` refuses missing transcripts and never submits another model request.
- First-release extraction proposes supported name/brand/quoted size only. Variant
  and pack remain unknown. Differing/estimated size quotes are shown as evidence,
  not normalized into a fixed size. Search-only prose stays unresolved; the review
  contract can represent structured search-only evidence with explicit acknowledgment,
  but the deterministic exporter does not invent such fields from summaries.

## Review and receipt integration

`service.ts` checks current organization membership and owner/admin roles, handles
scoped pagination/details, selected-field approval/rejection, re-research admission,
and receipt deletion cancellation. Approval checks current product/proposal versions
and writes the approved version and before/after evidence-backed audit atomically.
Repeated identical decisions do not duplicate updates; conflicting ones return 409.
Stale proposals cannot overwrite current products; after refresh they can be rejected
without changing the newer product. Re-research has a separate immutable admission
key ledger, including repeated paused requests, and shares import quotas/locking.

The Hono API mounts at `/api/product-research` with list, context, detail, approve,
reject and research-again routes. Cookie-authenticated writes require the configured
browser Origin, UUID/schema-valid actions, and small payloads. No publication or
claim HTTP endpoint exists. Authorization is checked inside services, not just UI.

`/product-research` provides an inbox, navigation count, sources, conflict/missing
field warnings, explicit field selection, rejection reasons and decision history.
Only approved metadata can become a receipt display name. The original description,
prices, quantities, taxes and shared spending categories are not rewritten.
Receipt links display the latest request for the admission identity. Legacy receipt
lines without an eligibility association are not silently backfilled; foreign-market
or unsupported lines cannot gain a Canadian identity merely by matching SKU digits.

Receipt deletion atomically cancels orphaned non-manual unpublished work, clears its
claim, and prevents stale publication. Explicit admin-owned re-research is retained.
Organization deletion cascades tenant records; persistent-file cleanup/retention is
still an operational gate, not a background service implemented by this package.

## Automatic offline processing

`runAutomaticOffline` in `src/automatic.ts` polls the existing queue sequentially.
It is default-off, requires an explicit organization policy, and accepts **offline
executors only**. Default maxJobs is one attempt per process (finite 1-100); it
stops on execution failure. Policy is re-read between jobs/polls, and AbortSignal
stops idle polling or cancels an active executor. Paused requests are never promoted.

Queue claims remain globally single-active and fenced, including across processes.
Process restart never reclaims running/expired work or reruns terminal requests.
Transient publication errors alone receive at most three attempts with the same
validated result; invalid/stale/permanent failures do not retry. An uncertain commit
is safe to republish idempotently. Exhausted publication errors stop the loop with
the claim retained, not permission to infer again. Executors must persist evidence
before returning; a process crash still requires explicit operator recovery.

The isolated browser demo uses this loop. `sku:auto:offline` exercises it only on
local disposable test DBs with static unresolved output and private JSON exports;
it cannot target ben-local/production, read personal auth or enable live providers.
See [automatic worker instructions](../../apps/sku-worker/README.md#automatic-research-worker---offline-only).
A process-local attempt limit is not a persistent spending cap. The operator has
chosen to defer detailed accounting for the ChatGPT-plan dev run until an API-key
version; the offline entrypoint remains offline-only.

## Automatic ChatGPT development processing

`src/automatic-chatgpt.ts` adds a distinct, explicitly consented ChatGPT-plan
entrypoint. It reuses provider-neutral polling and the same fenced claim lifecycle,
but requires `allowLive: true`, a `chatgpt-plan` executor, and current owner/admin
membership on each claim. Only queued work in that operator's allowed org is
processed; paused requests are not promoted. Existing offline gates remain intact.

The `sku:auto` executable is pinned to ben-local, requires separate ChatGPT grant
and enabled dev admission, and passes no DB/API-key environment to its Node child.
Default one-job cap, finite batch size, no automatic inference retries, saved-result
publication retry and pause/cancel behavior apply. No daemon starts through the
API and no live-execution HTTP endpoint is added. The UI's existing owner-authorized
queue/research-again action is sufficient to submit work to this consumer.

See [ChatGPT worker instructions](../../apps/sku-worker/README.md#automatic-research-worker---chatgpt-development).
Production/service/API-key rollout and automated recovery remain separate work.

## Explicit development pilot

`src/manual-pilot.ts` adds a separate one-request operator path, not a service
adapter or HTTP endpoint. It requires explicit live consent, current owner/admin
membership, scoped admission quotas and an exact queued request claim. It never
calls `runNext` with a live executor or weakens that function's offline-only gate.
The standalone command is pinned to Neon `ben-local`; see
[`sku:pilot` instructions](../../apps/sku-worker/README.md#one-request-development-pilot).
Other requests stay paused; results still require human approval. No live calls
are made by its faux/fixture tests, and production operational gates remain open.

## Testing and remaining gates

```bash
bun run --cwd packages/product-research check-types
bun run --cwd packages/product-research test
bun run --cwd packages/receipt-import test
bun run --cwd apps/sku-worker check-types
bun run --cwd apps/sku-worker test
bun run --cwd apps/web test:research
bun run --cwd apps/server check-types
```

Database tests run on isolated PostgreSQL/WASM by default and on a disposable
multi-connection PostgreSQL 16 service in CI using the production pg adapter.
See [test database restrictions](../receipt-import/README.md#tests); never use app
credentials or a real database for these destructive fixture tests. They cover
claim fencing, default-off execution, tenant/role/Origin boundaries, publication
retry, stale/concurrent decisions, atomic audit rollback, paused-key idempotency,
new generations, deletion races, foreign markets and microsecond-safe pagination.
Node SKU tests exercise actual temporary Pi SQLite persistence and faux inference.
React server-render tests check escaped source text and withheld executable URLs.
The additional disposable browser demo now verifies actual UI interactions with
synthetic results; it is not a live-provider or production-auth acceptance test.
See [demo instructions](../../apps/research-demo/README.md).

Migrations `0003_product_research_review.sql` and
`0004_product_research_action_keys.sql` extend the Phase 1 schema. None has been
applied outside isolated tests. Follow the baseline/ledger/config rollout caution
in `packages/receipt-import/README.md` before merging to auto-deploying main.

The synthetic receipt -> inbox -> approve/reject browser workflow passes locally.
Still required before production: passing native PostgreSQL CI; staged production
auth/provider acceptance; Neon/RDS connectivity and schema-copy
upgrade rehearsal; supported service credentials/models; monetary reservations and
inner-search accounting; a reviewed live executor/worker host; total resource limits,
backup/restore and fenced recovery drills; artifact deletion/retention and operational
monitoring/runbooks. There is no funded account or personal-plan fallback in this
implementation. The citation delay API mismatch has been fixed, and full-workspace
type checking now passes.
