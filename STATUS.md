# Where I left off: local Durable SKU worker

Updated: 2026-10-23

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
