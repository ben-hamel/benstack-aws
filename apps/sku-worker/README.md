# Local SKU research prototype

A standalone CLI worker for Costco Canada, using Pi Durable 1.5.0, a separate
ChatGPT plan-use login, and OpenAI hosted web search. Optional direct page reading
uses `pi-web-access`'s standalone MCP server; new research no longer calls Exa.
It does not import Benstack's environment, connect to Postgres, change the existing
chat, update product records, or deploy infrastructure.

An explicit **offline** queue bridge is now available in `src/queue-executor.ts`
for fixture/faux-provider integration with the app's review workflow. It does not
start automatically, load personal credentials, or enable service billing. Structured
proposals come from committed direct-page evidence via `openJob().result()`, not
answer prose; conflicts and missing variant/pack evidence remain unresolved.
See [worker/review integration](../../packages/product-research/README.md) for
claim fencing, saved-result publication, approval boundaries, and launch gates.

## Automatic Research Worker - ChatGPT development

The separate `sku:auto` command now connects the automatic queue loop to the
existing ChatGPT-plan Node worker, **only on the pinned Neon ben-local endpoint**.
It is not started by the API or deployed to production.

```bash
bun run sku:auto -- --help
bun run sku:auto -- --allow-live --max-jobs 1
```

Both explicit `--allow-live` consent and enabled org-scoped admission are required.
It resolves one owner/admin from ALLOWED_EMAILS (use `--organization` if ambiguous),
reauthorizes membership on each claim, and processes only that organization's
QUEUED requests. Existing PAUSED requests stay paused. Newly imported eligible
products queue when the dev API has `PRODUCT_RESEARCH_ADMISSION_ENABLED=true` and
its org allowlist configured. To start one old paused request from the app, choose
it in Product research, acknowledge allowance use and click **Queue research**.
Use direct **Upload (dev)** until the AWS upload path has an isolated dev pipeline.

Default maxJobs is **one attempt per process start**; the command waits for work,
then exits after one job. It does not restart itself. Larger finite batches require
an explicit `--max-jobs` value (maximum 100), still sequential and subject to
admission quotas. Add `--drain` to exit instead of waiting when no claim is available.
A failed execution stops the worker; terminal/running/expired requests are never
silently restarted. Completed evidence is saved under the existing
`<worker-state>/pilot-jobs/<request-id>/` path before publication. Transient DB
publication retries reuse that result, not inference. Failures requiring recovery
remain an explicit operator task; there is no automatic recovery loop.

The coordinator uses a separate local state lock in
`<worker-state>/auto-coordinator/`. Create `PAUSED` there to stop new claims; the
current job may finish. Ctrl+C cancels active work with graceful child shutdown,
then a bounded hard-stop fallback. Remove PAUSED and explicitly restart to resume.
The Node worker receives no database/AWS/API-key settings, uses only the separate
worker ChatGPT grant, and never falls back to API billing or personal Pi/Codex auth.
Approval remains in the regular app; no product fields are auto-approved.

The operator chose to defer detailed token/cost accounting until an API-key
version. ChatGPT plan windows are NOT hard per-job token caps. Existing five-minute,
eight-turn and 12-tool-call limits remain, but are not precise monetary limits.
Persistent usage reservations, automated recovery, service credentials and hosting
are still production/API-key rollout considerations, not features of this dev run.

## Automatic Research Worker - offline only

The automatic loop is implemented in
`packages/product-research/src/automatic.ts`. It watches queued requests without a
per-request terminal command, processes one at a time, and publishes proposals for
human review. **The offline entrypoint still rejects live executors and its
standalone command cannot target ben-local or production.** The separate explicitly
consented ChatGPT dev entrypoint is described above. Neither promotes paused work.

Safety behavior:
- Disabled unless supplied an explicit enabled organization allowlist; rechecks
  policy between jobs/polls. A runtime pause stops new claims; Ctrl+C cancels work.
- Default **one attempted job per process**, configurable only to a finite 1-100
  offline jobs. Stops on execution failure instead of consuming the remaining queue.
- Existing DB locks/fenced leases permit only one active request globally, even
  with two worker processes. Expired running jobs are NOT automatically reclaimed.
- Duplicate uploads reuse DB requests. Finished/failed/running jobs are not
  automatically reexecuted when the worker process restarts.
- Transient DB publication errors get at most three attempts using the SAME result;
  execution is never repeated. Permanent errors stop immediately. Exhausted or
  uncertain publication leaves the running claim for operator inspection.
- Paused admission, tenant scope, human approval and original receipt facts remain
  unchanged. This per-process count is NOT a persistent monetary/token allowance.

The browser demo now exercises this same loop with its isolated fictional data.
A standalone smoke-test command is also available:

```bash
bun run sku:auto:offline -- --help
RECEIPT_IMPORT_TEST_DATABASE_URL=postgresql://test:test@127.0.0.1:55432/receipt_import_test \
  bun run sku:auto:offline -- --enabled --organization fixture-org --max-jobs 1
```

The standalone command requires an **already initialized disposable local** test
DB. It does not create/drop schemas, seed users, or enable receipt admission. It
never reads app `.env` files or `DATABASE_URL`; Neon and normal app databases are
rejected. It imports no model/search/page provider and never accesses worker auth.
It publishes clearly labeled synthetic **unresolved** results only, saving JSON
first in `~/.local/state/benstack-sku-auto-offline/exports/`. Add `--drain` to stop
when no claim is available, otherwise it waits for later uploads. Create
`~/.local/state/benstack-sku-auto-offline/PAUSED` to stop new claims, or Ctrl+C to
cancel. Removing the file does not restart an exited worker automatically.

The automated native-PG tests start the actual command against fixture data and
verify its export/publication. They also cover concurrent polling, upload pickup,
restart deduplication, failure stopping, cancellation, pause, transient retry and
lost commit acknowledgment without repeating execution. No live call is involved.

The ChatGPT development entrypoint is separate from this offline interface; it does
not relabel a live executor as offline. Production/API-key rollout still needs
appropriate accounting, recovery/republishing, service hosting and monitoring.

## One-request development pilot

The separate Bun coordinator connects **only** to the verified Neon `ben-local`
direct endpoint (pinned in `src/pilot-config.ts`). Normal `sku research` remains
standalone. Nothing starts automatically and no public live-execution API exists.

```bash
# Read-only list: request UUID, SKU and state; no worker credential access.
bun run sku:pilot
# Read-only inspection of exactly one request.
bun run sku:pilot -- --request <request-uuid>
# Explicit live run; consumes the separately authorized ChatGPT plan allowance.
bun run sku:pilot -- --request <request-uuid> --allow-live
```

Use the already configured ignored `apps/server/.env.local` (`DATABASE_URL` and
`ALLOWED_EMAILS`). Only a matching owner/admin account may operate the request;
ambiguous accounts fail closed. Run `bun run sku login` separately if needed.
No API-key or personal Pi/Codex fallback exists. A pooled, production or unknown
DB endpoint is rejected before connecting. TLS verification remains enabled.

The coordinator promotes only the selected paused request through existing
admission/quota checks, claims only that UUID, renews its fenced lease, and spawns
the Node durable worker with **no database, AWS or API-key environment settings**.
Other requests stay unchanged. It saves validated evidence before publication;
results become `awaiting_review` or `unresolved`, never approved catalog fields.
Both the coordinator and child have a five-minute execution limit; the existing
12-tool-call budget and an eight-turn limit apply. Hosted-search inner calls and
output tokens are not a hard monetary cap; this is NOT a production service.

Pilot jobs live separately under `<worker-state>/pilot-jobs/<request-uuid>/`.
Completed saved JSON is identity-checked and reusable without inference. Existing
interrupted SQLite without an exported result is NOT silently resumed. Ctrl+C,
execution failure or invalid evidence fails the request without deleting local
state; publication failures leave a fenced running claim. Do not reset/requeue it
or start another generation to recover blindly. This first pilot has no automatic
recovery or saved-result republishing CLI: inspect/fence saved work with an operator
before recovery. No daemon, full-backlog enablement, provider billing rollout, schema
push/migration or production deployment is performed by this command.

Tests use faux inference/fixture pages and disposable DBs. No live research run is
claimed for this bridge until explicitly authorized and observed.

## First run

Requires Bun for workspace installation and **Node.js 22.19+** for execution.
Commands below run from the repository root. No compilation step is needed.

```bash
bun install --ignore-scripts
bun run sku login
```

Open the displayed OpenAI sign-in link and approve ChatGPT plan usage for
**Benstack SKU Worker**. This is not AWS SSO and does not reuse your existing
Pi/Codex credentials. Account eligibility, consent and subscription limits apply.

**Over SSH:** the browser callback points to `http://127.0.0.1:1455/auth/callback`
on the machine running the browser. If it cannot connect, copy the **entire final
redirect URL** from the browser address bar and paste it into the worker terminal.
Input is hidden. Do not paste it into chat or save it in an issue. With local port
forwarding, the callback can instead complete automatically. The worker uses Pi's
provider-owned PKCE flow, stable installation ID, issued client ID, and locked
refresh handling rather than implementing its own OAuth exchange.

Then:

```bash
bun run sku status
bun run sku research 1572430
```

The known manual test case is **Bounce Outdoor Fresh Dryer Sheets, 2 x 160 sheets**.
That expected answer is not included in the worker's prompt. Results are proposals
for you to review, not approved catalog entries.

Before starting research, the worker fetches your account-specific model catalog.
It prefers `gpt-6.1-sol` when available, otherwise the first listed model also known
to Pi. To choose another:

```bash
bun run sku models
bun run sku research 1572430 --model gpt-6-luna
```

`models` lists the signed-in account's visible ChatGPT models from
`GET https://api.openai.com/v1/models` (`models[].slug`). Models not yet known to
Pi are marked and cannot be selected. An explicit `--model` must appear in both
catalogs. The live inference request is still authoritative about availability.
The worker refuses to fall back to an environment API key or another provider if
subscription access fails. It sends streaming Responses requests through Pi's
OpenAI provider (`store: false`). This route rejects `max_output_tokens`, so there
is **no per-response output-token cap**; the provider controls output limits.
This is not unlimited subscription access or a production billing setup.

## Test search separately

```bash
bun run sku search-test 1572430
```

This calls OpenAI hosted `web_search` in a separate Responses request, requires the
worker login, and **uses ChatGPT plan allowance**. It tests the search service without
running the outer Durable research conversation. Queries and source inspection go
to OpenAI. There is no silent fallback to Exa or API-key billing.

Search and reasoning are separate: `--model` chooses the outer reasoning model,
while the search adapter independently selects an available OpenAI model. Adding
Claude reasoning later would require its provider/auth setup, but it could still
call this OpenAI search adapter with the worker's OpenAI authorization. The current
CLI only configures OpenAI reasoning; accepting a Claude model is not implemented.

Hosted search requests use `store: false`, `stream: true`, a required `web_search`
tool, and an `allowed_domains` filter for the selected Costco site. OpenAI's filter
includes subdomains; it is not our direct-fetch security boundary. The adapter waits
for `response.completed`, an observed hosted search call, and a supported Costco
citation. Partial or failed streams are rejected. Successful output is still a
**model-generated summary**, not a deterministic extraction or proof of correctness.
One outer tool call can produce multiple hosted searches and consumes additional
model/search allowance. Those inner requests are not included in Pi Durable's
outer-model token totals.

For research, the model can choose among exactly two tools:

- `search_costco`: hosted research for an exact numeric SKU on Costco.ca, Costco
  Same-Day Canada, or Costco Business Centre Canada. The SKU comes from saved job
  state, not model input. Returns a clearly labelled OpenAI summary with citations.
- `fetch_costco_page`: direct product evidence from HTTPS pages on those exact
  hosts (and their `www` aliases). Fetches HTML once, then extracts JSON-LD Product
  fields plus Costco's named product-details and specifications sections. Same-Day
  additionally supports a separately verified item header (details below). The saved
  job SKU, not a model-supplied SKU, selects the product. Other hosts, local paths,
  credentials in URLs and nonstandard ports are rejected. The fetcher enforces
  same-origin redirects and blocks private IPs.

The agent has **no shell, filesystem, database or deployment tools**. No Costco
login, cookies, postal code or browser automation is supplied. Stock and price
cannot be assumed to apply to Newfoundland. Sources may be stale, abbreviated,
contradictory or inaccessible; search snippets are not proof of an exact match.
The system prompt treats page text as untrusted data, but this is not a guarantee
against prompt injection or incorrect identification. Human review is still required.

The page reader starts lazily for each requested page and closes after extraction,
releasing the full HTML held in the subprocess's memory.
Unlike article-style readable extraction, this path preserves structured SKU/name
fields and targeted size/pack evidence. It never executes page scripts, launches a
browser, or infers missing product attributes. Mismatched, absent, or conflicting
product identities are reported as unresolved; fields from separate products are
not merged. Pages without usable JSON-LD Product data or with changed selectors can
still lack evidence. Hosted search remains a separate, explicitly labelled source.

### Same-Day item-header evidence

Same-Day pages can omit `sku` from their Product JSON-LD while showing `Item: <SKU>`
in the product header. On the exact supported Same-Day host, extraction requires:
- One `#item_details` container, one product heading, and one adjacent item label
  whose complete numeric SKU matches the saved job.
- One distinct JSON-LD Product bound to the source page's origin/path, agreeing on
  the complete product name, with no conflicting structured SKU or declared URL.
- No malformed/skipped JSON-LD blocks or exhausted structured-inspection limits.

The `sameDayProduct` object keeps header SKU, name, displayed size text, and scoped
Details paragraphs separate from `structuredProduct`. It never fills in a missing
JSON-LD SKU. Unrelated item labels, recommendations, URL product IDs, guest/session
state, and executable scripts cannot supply identity. Header/layout changes fail
closed rather than falling back to whole-page text.

JSON-LD `size` and the displayed size are retained verbatim, with warnings not to
reconcile disagreements or turn estimated weight into fixed package weight. Pack
counts and brands are not inferred. Header size lines can contain quoted prices;
these are source text, not verified current price or Newfoundland availability.

Page-only validation on October 23, 2026 used public HTTP fetching, not model or
hosted-search requests. Both original pages failed the old exact-JSON-LD-SKU check.
After the fix, a fresh MCP fetch of item `55505` recovered the exact header SKU,
Kirkland whole chicken, three-chicken Details text, and the quoted estimated weight.
For `27003`, the initial response showed `908 g` in the header but `1 lb container`
in JSON-LD; the reduced fixture retains both. A fresh post-fix MCP fetch remained
unresolved, and a separate bounded HTTP diagnostic encountered storefront redirect
loops. Do not claim that case is live-verified after the fix or that the product is
unavailable. No full research job was run; broad Same-Day coverage remains unproven.

Response bodies are limited to 5 MiB by the fetcher and checked again before parsing.
The pinned library's MCP server returns text only; the worker reassembles its bounded
raw-content slices through `get_search_content`. These are local subprocess-memory
reads, not additional HTTP fetches or model calls. Lengths and offsets are validated;
incomplete or changed response contracts fail closed. HTTP status and MIME metadata
are not exposed by that MCP transport and are explicitly not claimed verified.

Compact extracted output is bounded to 16,000 characters and is what Durable saves;
full HTML is not sent to the model or stored in its transcript. The standalone MCP
process retains the raw body in memory until closed; the worker closes it after each
page. Its dedicated disk-cache directory is also cleared on startup/close, including
any leftovers from other library versions. This is not a hard memory/CPU sandbox;
hosted concurrency still needs a separate resource-management design. The retained Exa adapter is not used for search by the CLI.

The MCP subprocess receives a restricted environment and its own configuration,
not the parent's API keys, AWS environment or personal Pi configuration. This is
not an OS sandbox: it still runs as your OS user. Hosted extraction providers,
browser-cookie access, PDFs and GitHub-specific handling are disabled.
`pi-web-access` is pinned to 0.41.0, which meets this repo's three-day dependency
release-age policy; we did not bypass that policy to install 0.42.0.

## Progress output

`research` and `resume` watch Pi Durable's bounded conversation view via
`conversation.watch()`, attached before submitting work. Fixed `[progress]` messages
on **stderr** show observed model turns, Costco search/page-reader starts and
finishes, run failures, and run boundaries. A finished tool or ended run is not a
claim that research succeeded; the saved submission and final answer remain authoritative.

The initial view reflects saved activity; reopening a completed job does not replay
historical progress or start research again. Watches fold intermediate changes, so
transient states can be missed. Newly appended tool-result entries also supply
completion status when a tool's live slot is already gone. On pause or exit the
watch is stopped without cancelling the durable job. The final answer is printed
once on **stdout**, not streamed through progress messages. Live partial output can
be shown before its deferred SQLite write (up to about one second by default);
final answers and tool results are persisted before their submissions settle.

Progress never prints message/thinking deltas, tool arguments/results, arbitrary
tool names, or raw provider diagnostics. This is status visibility, not a token,
cost, or hosted-search-call meter. Implementation reference:
[upstream 1.5.0 JSON view example](https://github.com/earendil-works/pi/blob/v1.5.0/packages/durable/test/examples/18-json.ts).

## Saved evidence review

New jobs save an evidence-coverage summary in a separate Durable document, tied to
that job's final answer entry. The CLI prints it before the proposed answer:

```text
Job: done
Evidence: direct SKU match
Review flags:
- JSON-LD and displayed size text differ; compare the quotes manually.
- Pack count and final-answer claims are not automatically checked.
Human review required. This checks evidence coverage, not identification correctness.
```

`done` still means an answer was saved, not that the product identification is
correct. Evidence status is `direct SKU match`, `search-only`, or `unresolved`.
It comes from committed tool results, not the model's confidence or answer text.
A direct match requires the extractor's exact-SKU identity, matching requested SKU,
product name, and supported source URL (including the separately verified Same-Day
header path). Fetch errors and unverified/malformed page results remain review flags,
even when another page establishes a direct match.

Rules flag missing brands on matched extracts, different Same-Day JSON-LD/displayed
size strings, and approximation words in Same-Day displayed sizes. Different strings
are **not** a proven size conflict: no unit conversion or semantic comparison is
performed. Price text can itself make the strings different. Size evidence elsewhere,
pack count, and the final answer's claims are not comprehensively validated. Every
summary requires human review; there is no automatic approval, correctness score,
reviewer model, or automatic extra research.

Assessment scans at most 2,048 committed entries through the saved answer. Reaching
the limit forces `unresolved` with an incomplete-history flag. Only fixed flags,
counts, a rule version and the answer entry ID are saved in the summary; no extra
raw HTML or diagnostics are copied. Reopening a completed job reuses its summary
without research. If an answer was saved before its assessment committed, resume
can finish assessment from saved evidence without new model/search calls.
Jobs created before this feature have no opt-in document and show **not assessed**;
the worker does not silently backfill or approve them.

## Stop and resume

Research prints a job UUID before it starts. Press **Ctrl+C** to close the harness
without cancelling its durable work. Resume with:

```bash
bun run sku resume <job-id>
```

Each job has its own SQLite transcript and saved SKU/model/tool budget. A stable
request ID prevents duplicate user submissions when reopened. A completed job
prints its saved answer without another inference request (account model discovery
still makes an authenticated GET). An unfinished job recovers from persisted
progress. A gracefully closed model request may be sent again, and an interrupted
read-only search/fetch may repeat. A hard crash during a model request instead
counts as a failed attempt in 1.5.0; because this worker disables automatic model
retries, that run ends `unanswered` with reason `interrupted` rather than resending. Search-provider quota and model
allowance may therefore be consumed again. Nothing here guarantees exactly-once
external requests or survival of every last write after host power loss. Resume uses
the currently installed search adapter; completed jobs keep their cached answer.
Use a new `research` command to rerun an old Exa result with OpenAI search.

There is a five-minute limit per CLI invocation and a persistent 12-tool-call
budget per job. The time limit pauses work, not deletes it. These are not a total
job-token or cost limit. A run which has already failed and
settled as `unanswered` is not restarted by `resume`; check login/model availability
and start a new research job after correcting the cause.

One command owns the local worker state at a time. After a hard crash, allow about
10 seconds for the stale lock to clear. Keep these files on a persistent local disk;
container replacement would require an explicit persistence design.

## Crash-loop recovery

Pi Durable 1.5.0 no longer parks tasks and removed `harness.retryTask()`. After five
consecutive crashes without saved tool progress, a read-only tool ends with a
`restart_limit` error result instead of executing again. The model can still answer
from the error and any saved evidence; completion is not proof of a successful lookup.
Replaying a tool before that limit retains its original budget slot.

A hard crash during a model request ends the run `interrupted` with this worker's
no-model-retry policy. A run that itself hits the restart limit also ends. `resume`
reports these terminal outcomes without submitting more work or exposing raw
provider diagnostics. First fix the crash/resource cause, then explicitly start a
new `research <sku>` job if needed. **New research can consume model/search allowance
and has a new tool budget.** Saved answers/transcripts remain in the old job.

The obsolete `retry <job-id> <task-id>` command now fails with migration guidance
before authentication, model discovery, or opening any job. Ordinary Ctrl+C pause
and `resume` still work and do not require this command.

## Pi Durable upgrades

Pi Durable, Pi AI, Chord, and Pi Schema are pinned together to **1.5.0**. The worker
uses Pi Schema tool definitions, tagged harness reports, and conversation-view
watches instead of the removed event stream. Crash-loop handling follows the new
terminal-outcome policy above. The upstream API is **experimental**, not stable;
review release notes before changing these pins.

**Back up before opening old jobs.** Version 1.5.0 keeps SQLite schema v2 but
migrates built-in document/task versions when used; 1.4.0 cannot safely resume state
written by the newer harness. Opening a 1.3.0 job also automatically migrates its
database from SQLite schema v1 to v2, which 1.3.0 cannot reopen.
Before running `research` or `resume` against existing state after upgrading, stop
all worker processes and back up the jobs using SQLite's backup API (or copy each
closed database together with any remaining WAL files). Keep backups outside Git.
A rollback requires both the old dependencies and an unmigrated database backup.
The upgrade does not proactively migrate saved jobs; opening one does.

1.5.0 migration validation:
- Type checking and all 49 offline tests passed, including real SIGKILL recovery,
  graceful model/search pause and resume, stable submission/budget identity,
  completed-job reuse, fixed-label view progress, and obsolete CLI retry rejection.
- The existing SQLite schema v1-to-v2 preservation test still passes.
- No live login, model/search/page requests, or original saved-job migration was
  performed for this upgrade. Legacy built-in task/document migration is not
  comprehensively covered by the schema preservation test.
- Dependency/lockfile updates were already present when this migration was finished;
  no install or release-age override was needed during completion.

Historical 1.4.0 upgrade validation on October 23, 2026:
- Type checking and all 30 offline tests passed, including schema v1-to-v2 task-row
  preservation and the existing interrupted-search recovery test on 1.4.0.
- Copies of all 13 saved v1 jobs migrated and reopened successfully: 11 retained
  exactly the same completed answers and two retained their unanswered status.
  No model/search/page requests were made; original database/WAL hashes remained
  unchanged. No legacy unfinished job was available for migration/recovery testing.
- With user approval, the original strawberries job
  `3238d4af-c921-4285-9e93-95a42c3220b9` was then resumed through the CLI on 1.4.0.
  It returned its saved answer without new research; read-only inspection confirmed
  schema v2, SQLite integrity `ok`, and one submission. The CLI's authenticated
  model-catalog request was live. That original database is now migrated.
- The user approved a one-time release-age exception for this upgrade, installed
  with `bun install --ignore-scripts --minimum-release-age=0`. The lockfile changes
  were limited to the related Earendil packages; the repo's normal three-day
  release-age policy in `bunfig.toml` remains unchanged. Do not routinely use the
  override.

Version 1.4.0 used parked tasks after five crash recoveries. That behavior and its
retry command are superseded by 1.5.0's crash-loop recovery above.

## Local state and logout

Default directory:

```text
~/.local/state/benstack-sku-worker/
  host.json                  stable installation ID
  chatgpt-auth.json           private OAuth credential file
  worker.lock/               live process lock
  search/                    isolated MCP config and temporary search cache
  jobs/<job-id>/session.sqlite
```

Override with `SKU_WORKER_STATE_DIR` if needed. Use a private directory **outside
Git**. The worker creates directories with mode 0700 and credentials with mode
0600. OAuth tokens are not encrypted at rest; protect the OS account and disk.
Do not share or commit the state directory, and do not copy a host ID onto a new
installation. SQLite transcripts contain product research and model output, not
a deliberate copy of the OAuth credential store.

```bash
bun run sku logout
```

Logout removes this worker's local credentials only. Revoke provider access in
OpenAI's account controls when required. It does not log you out of regular Pi,
Codex or AWS, and does not delete saved jobs.

## Verification

```bash
bun run --cwd apps/sku-worker check-types
bun run --cwd apps/sku-worker test
```

Offline tests use scripted faux models, fake web results and temporary private
SQLite storage. They verify recovery, idempotent submission, the tool budget,
credential serialization/permissions, lack of API-key fallback, URL restrictions,
MCP argument contracts, hosted-search request/stream handling, and subprocess startup.
Product-extraction tests use reduced saved-page fixtures and cover Same-Day header
binding, contradictory size quotes, estimates, unrelated recommendations, layout
changes, malformed/limited data, and bounded output, as well as SKU selection,
malformed/ambiguous data, named product sections, output limits, text-only MCP
continuation reconstruction, saved-SKU forwarding, and reader cleanup.
Progress tests cover conversation-view updates with faux models, folded tool
completions, completed-job reopening, listener cleanup, payload suppression, and
pause/recovery with an attached watch. Recovery tests SIGKILL temporary subprocesses
once during a faux model request and five times during search, verifying terminal
interruption/restart-limit handling, stable submission identity, and tool-budget
preservation. Graceful model and search pause/resume remain separately tested.
CLI tests check obsolete retry rejection before state access and updated help.
Evidence-review tests cover direct matches, search-only answers, different size
quotes, estimates, failed/unverified pages, partial history, persisted summaries,
resume/recomputation without new research, and legacy jobs remaining unassessed.
They make no model or web-search requests. `search-test` is the separate live search check. End-to-end ChatGPT login
and inference require your consent and are not claimed verified by offline tests.

## Scope

This is a **single-user local experiment**, not an always-running service or a
multi-user auth implementation. Shared hosting, token encryption/secret storage,
per-user authorization, review UI and approved catalog updates are outside this
prototype. OpenAI directs paid/remotely offered
apps to a separate access process; do not treat personal plan consent as permission
to serve all Benstack users from your account.

References:

- [OpenAI ChatGPT plan-use integration](https://developers.openai.com/siwc/token-sharing-open-source)
- [OpenAI self-hosted VM guidance](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
- [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)
- [Pi Web Access](https://github.com/nicobailon/pi-web-access)
