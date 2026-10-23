# Local SKU research prototype

A standalone CLI worker for Costco Canada, using Pi Durable 1.4.0, a separate
ChatGPT plan-use login, and OpenAI hosted web search. Optional direct page reading
uses `pi-web-access`'s standalone MCP server; new research no longer calls Exa.
It does not import Benstack's environment, connect to Postgres, change the existing
chat, update product records, or deploy infrastructure.

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
  fields plus Costco's named product-details and specifications sections. The saved
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
structured product identities are reported as unresolved; fields from separate
products are not merged. Pages without JSON-LD Product data or with changed section
selectors can still lack evidence, including Same-Day pages. Hosted search remains
a separate, explicitly labelled source.

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

`research` and `resume` observe Pi Durable's committed `watchEvents()` stream,
attached before submitting work. Fixed `[progress]` messages on **stderr** show
model turns, Costco search/page-reader starts and finishes, and run boundaries.
A finished tool or ended run is not a claim that research succeeded; the saved
submission and final answer remain authoritative.

The initial snapshot reflects saved activity; reopening a completed job does not
replay historical progress or start research again. Slow observers can receive a
replacement snapshot instead of every intermediate event. On pause or exit the
observer is detached without cancelling the durable job. The final answer is
printed once on **stdout**, not streamed through progress messages.

Progress never prints message/thinking deltas, tool arguments/results, arbitrary
tool names, or raw provider diagnostics. This is status visibility, not a token,
cost, or hosted-search-call meter. Implementation reference:
[upstream 1.4.0 JSON event example](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/test/examples/19-json.ts).

## Stop and resume

Research prints a job UUID before it starts. Press **Ctrl+C** to close the harness
without cancelling its durable work. Resume with:

```bash
bun run sku resume <job-id>
```

Each job has its own SQLite transcript and saved SKU/model/tool budget. A stable
request ID prevents duplicate user submissions when reopened. A completed job
prints its saved answer without another inference request (account model discovery
still makes an authenticated GET). An unfinished job recovers
from committed progress; an interrupted model request may be sent again, and an
interrupted read-only search/fetch may repeat. Search-provider quota and model
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

## Parked-task recovery

After five consecutive crashes without saved task progress, Pi Durable parks the
task instead of restarting it indefinitely. `resume` detects parked tasks before
starting research and exits with the exact job/task retry command instead of
waiting for the five-minute limit. Harness reports also identify parked task IDs;
raw error payloads are not printed.

First investigate/fix the cause (for example, a repeatable process crash or resource
limit). Then explicitly retry the numeric task ID shown in the message:

```bash
bun run sku retry <job-id> <task-id>
```

This clears that task's crash counter via `harness.retryTask()` and continues the
same saved job/submission with normal progress output, Ctrl+C pause, five-minute
invocation limit, and persistent tool budget. It does not create a new research job
or reset the budget. Replaying the same tool task keeps its existing budget slot.
Only a currently parked task belonging to that job can be retried: missing,
completed, or non-parked task IDs are rejected rather than silently resumed.
If other tasks remain parked, the worker prints their retry commands too.

**Retry can repeat interrupted model/search/page requests and consume allowance.**
There is no automatic retry of parked tasks. This is not a general retry for jobs
already settled as `unanswered`, nor a fix for the cause of a crash. Ordinary
Ctrl+C pause/resume does not need this command. Like `resume`, `retry` requires the
worker login, checks the account model catalog, and can migrate legacy SQLite state.

## Pi Durable upgrades

Pi Durable, Pi AI, and Chord are pinned together to **1.4.0**. This upgrade added
an explicit `checkpointWhen` policy to the worker's document definition. The
upstream API is experimental; review release notes before changing these pins.

**SQLite migration is automatic and one-way:** opening a 1.3.0 job with 1.4.0
migrates its database from schema v1 to v2. Version 1.3.0 cannot reopen it afterward.
Before running `research` or `resume` against existing state after upgrading, stop
all worker processes and back up the jobs using SQLite's backup API (or copy each
closed database together with any remaining WAL files). Keep backups outside Git.
A rollback requires both the old dependencies and an unmigrated database backup.
The upgrade does not proactively migrate saved jobs; opening one does.

Upgrade validation on October 23, 2026:
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

Version 1.4.0 also parks tasks after five consecutive crash recoveries without a
new checkpoint. See parked-task recovery below. Graceful close/resume is not
counted as a crash.

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
Product-extraction tests use reduced saved-page fixtures and cover SKU selection,
malformed/ambiguous data, named product sections, output limits, text-only MCP
continuation reconstruction, saved-SKU forwarding, and reader cleanup.
Progress tests cover real committed tool events with faux models, completed-job
reopening, listener cleanup, payload suppression, and pause/recovery with an
attached observer. Recovery tests kill temporary subprocesses during faux model
and search execution five times, verify real crash-loop parking, and check explicit
retry, invalid targets, stable submission identity, and tool-budget preservation.
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
