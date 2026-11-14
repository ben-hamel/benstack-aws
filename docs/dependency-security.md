# Dependency security checkpoint

Reviewed on 2026-11-14, starting from merged `main` (`e83be56`).

## Scope

- Keep Better Auth at 1.7.20, Vite on 6.x, and AI SDK on 6.x. No application,
  database schema, deployment workflow, or environment-file changes.
- Upgrade Hono to 4.13.17 and Vite to 6.4.6.
- Refresh compatible AWS SDK, AI SDK, LangChain, TanStack Router, Streamdown,
  PostCSS, Turbo, and Drizzle Kit dependencies.
- Update S3 dependencies in both the API and receipt processor so an older SDK
  dependency tree is not retained by the receipt workspace.
- Preserve `bunfig.toml`'s 259200-second (three-day) minimum release age and the
  shared dependency catalog. No release-age exceptions.

`@langchain/anthropic` is temporarily pinned to **1.6.2**. Version 1.6.3 requires
`@langchain/core ^1.3.7`, which did not pass the release-age policy at this
checkpoint. Revisit this pin when a compatible core version clears the policy.

## Transitive security floors

The root `overrides` keep patched versions of DOMPurify, defu, brace-expansion,
Babel core, Browserslist, baseline-browser-mapping, source-map-js, tsx, and uuid.
These stay within the major versions and dependency ranges used by their current
parents. A parent-only update otherwise retained vulnerable nested copies.
Review these overrides as upstream parents adopt the patched minimum versions.

TanStack's updated dependency tree resolves Seroval 1.8.0, removing the two
critical deserialization advisories in the previous 1.5.1 installation.

## Audit result and remaining work

`bun audit --json`: **26 flagged package names before, 4 afterward; no remaining
high or critical advisories.** Four advisory entries remain: two moderate and
two low. This is a dependency audit, not a full exploitability assessment.

| Remaining package | Severity | Reason not forced in this update |
| --- | --- | --- |
| `deepmerge` 4.3.1 | Low | Used by the shadcn CLI/registry; no patched upstream release was available. Do not treat untrusted CLI registry input as safe. [Advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) |
| `esbuild` 0.18.20 | Moderate | Drizzle Kit's legacy `@esbuild-kit/esm-loader` constrains this version. The advisory concerns esbuild's development server; Vite itself resolves the unaffected 0.25.12 branch. Do not expose an esbuild development server. The separate Windows finding is fixed by refreshing `tsx` to 4.23.15, which uses esbuild 0.28.2. Follow upstream legacy-loader updates rather than force an incompatible 0.x upgrade. [Development server advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| `katex` 0.16.x | Low | Fix requires 0.18.2+, outside current math-renderer dependency ranges. The advisory requires existing prototype pollution; that prerequisite is not a blanket safety guarantee. Update math-renderer parents or separately validate a KaTeX upgrade. [Advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7) |
| `minimatch` 10.2.4 | Moderate | shadcn -> ts-morph -> @ts-morph/common constrains this to 10.x; patch requires 11.0.1+. Follow upstream or separately validate the major upgrade. [Advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

No advisories are suppressed, and `bun audit` still exits nonzero for these
remaining findings.

## Validation

Passed:

- `bun run check-types` (includes the frontend production build and UI/API type checks)
- `bun run --cwd apps/server build:lambda`
- `bun run build:lambda` (receipt processor)
- `bun install --frozen-lockfile --ignore-scripts`
- `git diff --check`

The frontend retains its existing large-chunk build warning. No database pushes,
paid model calls, browser chat validation, merges, or deployments were performed.
