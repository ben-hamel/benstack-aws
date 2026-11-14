# Better Auth upgrade and local API proxy

## Safety boundary

Work is local on `feat/better-auth-upgrade-proxy`. No main merge, Git push,
deployment, persistent database/schema push, provider request or worker start
is authorized by this work. As a separate final safety change, all four deployment
workflows are made manual-only (workflow_dispatch); main pushes no longer trigger
deployment when these workflow changes reach main. Until then, main's existing
workflows remain automatic. No workflow has been dispatched. Manual deployment
still needs target/backup/schema/rollout review; its db:push behavior is unchanged.

Before changes, a private local backup was created at:
`/home/ben/.local/state/benstack-checkpoints/20261114T005335Z-auth-upgrade/`.
It contains the worktree, ignored local env files, a Git history bundle, and
worker state (SQLite databases backed up using SQLite's backup API).
Files are private (directories 0700, files 0600), with archive checksums.
This is not an off-machine backup and **not a Neon database backup**.

Local checkpoints:
- `4fba981`: existing receipt/research/Web Functions work before this task.
  A safety snapshot, not a claim that all inherited work is production-ready.
- `fb853c5`: integration-test baseline on Better Auth 1.5.5.

The previously running API/frontend were stopped before dependency changes.
No real database or personal login is used by the new tests.

## Version choice and compatibility

Catalog pin changes from **1.5.5 to 1.7.20** for client and server together.
On 2026-11-14, npm's latest stable was 1.7.23, but it was published less than
three days earlier. 1.7.20 was the newest stable allowed by the repository's
`minimumReleaseAge` safeguard. That safeguard remains unchanged.

Reviewed the 1.6 release notes, 1.7 upgrade guide and stable release metadata:
- https://www.better-auth.com/blog/1-6
- https://www.better-auth.com/docs/guides/1-7-upgrade-guide
- https://registry.npmjs.org/better-auth

Relevant behavior:
- Session freshness now uses creation time rather than refreshed update time.
- Password hashes remain compatible; a synthetic hash generated and verified
  under 1.5.5 is used in a successful existing-user login test under 1.7.20.
- Static explicit auth base URLs continue to avoid forwarded-header inference.
- The app uses email/password, organization (without teams), admin and the
  built-in Drizzle adapter. OAuth provider/SCIM/MCP/team-counter schema changes
  do not apply to those enabled features.
- Tests compare the configured library's model fields to the current Drizzle
  schema and exercise the adapter against SQL generated from those definitions.
  No app schema files, migration ledger or persistent DB were changed.
  This is not a guarantee about any deployed schema: db:push does not maintain
  migration history, and production compatibility still needs actual inspection.

Before a persistent rollout: verify the target, take and verify a fresh DB
backup, inspect the actual auth schema, and check duplicate provider/account
keys using the project's physical names:

```sql
SELECT provider_id, account_id, count(*)
FROM account
GROUP BY provider_id, account_id
HAVING count(*) > 1;
```

That query has not been run on a persistent DB during this task. Do not run
upstream CLI migrations: this project retains its reviewed Drizzle db:push
workflow. Existing app startup may perform LangGraph setup DDL, which is
separate from the offline auth tests.

## Integration test design

```sh
bun run --cwd apps/server test:auth
```

Uses in-memory PGlite, actual Better Auth + Drizzle adapter, the project's real
auth hooks and org middleware, Chromium, and the real frontend auth-client
module served by Vite. It does not mock successful authentication.

The existing auth and org middleware were extracted into injectable factories;
normal production/local singletons still receive the original DB and env.
Origin and CSRF checks are explicitly enabled because Better Auth otherwise
bypasses origin checking when NODE_ENV=test.

Test coverage:
- Registration admission and automatic owner/org creation.
- Existing-user login selects the organization.
- HTTP-only, SameSite=Lax session cookies and refresh persistence.
- Protected-route 401s, active tenant selection and membership revalidation.
- Untrusted authenticated request origins and callback URLs rejected.
- Logout, session revocation and replay rejection.
- Wrong passwords, non-allowlisted registration and legacy password hashes.
- Enabled auth model fields remain present in today's Drizzle schema.

Schema is generated into memory from current definitions, not replayed from the
historical migration ledger. All fixture users, secrets and password hashes are
synthetic. Browser HTTP requests are restricted to loopback. Test Vite ignores
real env files and receives an explicit fake app configuration.

On minimal Fedora hosts, optional test-only browser libraries are read from
`~/.cache/benstack-browser-libs/root/usr/lib64` (override
`AUTH_TEST_BROWSER_LIB_DIR`). CI installs browser dependencies using the existing
Playwright setup. These libraries do not affect normal application runtime.

Baseline 1.5.5: seven browser integration tests passed before the dependency
change. Upgraded 1.7.20: nine passed, including added schema and legacy-hash
checks. OAuth, email delivery and browser HTTPS/secure-cookie behavior are not
covered by these HTTP fixtures.

## Proxy and manual development

Use `bun run dev:local` or `bun run dev:network` from the repository root.
The network command discovers Tailscale IPv4 and prints the browser URL on port
3001; the API stays on 127.0.0.1:3000. The launcher aligns auth/CORS URLs with
the frontend, and Vite forwards `/api/*` while preserving cookies, paths,
multipart bodies and streaming. It does not edit saved env files. Credentials
continue coming from the API's existing env files. Starting the full app uses
those configured dev services and runs the app's normal DB/checkpointer setup.
No persistent database was accessed during this upgrade task.

Proxying is dev-only and opt-in outside those launchers. Production builds keep
the existing VITE_SERVER_URL and separate-origin deployment; no CloudFront or
other production routing was changed. No proxy header trust, cookie rewriting,
security bypass or persistent auth schema change was required.

Validation completed before the user requested stopping further test work:
27 auth/network tests (direct and proxied), nine runtime tests, workspace types,
production frontend build, Lambda bundle, frozen install, and the existing
receipt/product-research/worker/evidence suites passed. The isolated demo API's
second PostgreSQL/WASM initialization exceeded its old five-second test limit;
that one fixture test now has the same 30-second initialization budget as its
suite setup, and all seven demo API tests passed. Assertions are unchanged.
The separate demo browser run was interrupted at user request, so its result
is NOT claimed. Its leftover disposable server was stopped.

The real dev servers remain stopped after the dependency update. Manual testing
can resume with `bun run dev:network`; no automated or manual login on the real
development DB was performed as part of the upgrade. Further test expansion is
deferred at the user's request. Nothing has been pushed or deployed.
