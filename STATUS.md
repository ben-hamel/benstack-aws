# Where I left off: local Durable SKU worker

Updated: 2026-10-22

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
- The working tree was clean before creating this checkpoint. Neither commit was
  pushed during the checkpoint/policy-review session; check current remote state
  rather than assuming that remains true.

## Verified versus uncertain

The commits and current branch were inspected in the checkpoint session. Worker
implementation was not resumed, tests were not rerun, and live login, inference,
search, or resume behavior was not verified in that session.

The worker README documents offline tests and separate live checks. Do not infer
that those checks have passed just because they are documented. Earlier
implementation-session live results have not been reconstructed here.

## Next action and why

**Establish the actual validation state, then discuss the next milestone before
changing code.** This avoids repeating successful work or assuming the prototype
is fully validated.

1. Read `apps/sku-worker/README.md` and inspect current Git status/history.
2. Ask me what was already tried successfully in the earlier implementation
   session, or consult its non-sensitive notes if available.
3. Summarize what is known, what remains unverified, and recommend one next step.
4. Agree whether to stop at the prototype milestone or run a bounded validation
   session. Do not automatically start more implementation or live requests.

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
> commits. Help me reconstruct which validations already succeeded and recommend
> the next concrete step. Discuss before changing code, starting live requests,
> logging in, or committing. Do not automatically resume worker implementation.

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
