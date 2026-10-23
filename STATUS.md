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
- Working tree was clean before this checkpoint update. Remote/push state was not
  checked this session.

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
- The latest two jobs (`a3763fe7-8915-44d9-89ea-794dafdfda59` and
  `93dd5be0-45d4-450d-82d6-42b022e3d821`) successfully used OpenAI hosted search
  on Same-Day and Business Centre after Costco.ca returned no supported citation.
  Both proposed green onions, 907 g, for `3028018`, with moderate confidence.
- Live inference, hosted search, page fetching, and saved-answer persistence
  therefore worked in those historical runs. Direct page extraction sometimes
  returned boilerplate or omitted SKU/size headers; the final answers distinguished
  hosted-search claims from independently fetched evidence.

Interrupt/resume behavior and a separate `search-test` run are not established by
this inspection. Offline tests were not rerun, and current authentication/service
availability was not checked. No implementation or infrastructure was changed.

## Next action and why

**Agree on the next milestone before changing code or making live requests.**
Historical end-to-end research is now established; do not repeat login/search
checks merely to reconstruct progress.

Recommend a bounded interrupt/resume validation if continuing prototype validation,
since that remains unverified. Agree on request/allowance scope first. Alternatively,
stop at the prototype milestone or discuss improving direct SKU/size extraction as
a separate implementation task. Do not automatically start any of these.

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
> commits. Historical live research is confirmed from saved Durable transcripts;
> interrupt/resume remains unverified. Help me choose the next milestone. Discuss
> before changing code, starting live requests, logging in, or committing. Do not
> automatically resume worker implementation.

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
