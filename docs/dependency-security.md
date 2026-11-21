# Dependency security checkpoint

Reviewed on 2026-11-14, starting from merged `main` (`e83be56`).

## Scope

- Keep Better Auth at 1.7.20, Vite on 6.x, and AI SDK on 6.x. No auth-flow,
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

The root `overrides` keep patched versions of DOMPurify, defu, Babel core,
Browserslist, baseline-browser-mapping, source-map-js, tsx, and uuid within their
parents' declared dependency ranges. Parent-only updates otherwise retained
vulnerable nested copies. Review overrides as upstream parents adopt patched
minimum versions.

The follow-up also overrides KaTeX to **0.18.11**, deliberately crossing the math
plugins' current 0.16.x ranges. Its public renderer API was validated through the
actual chat Markdown component. The web app explicitly depends on KaTeX and
imports its matching stylesheet, including the newer internal class names; the
app has no custom selectors depending on the old names. This is a tested override,
not a claim of upstream plugin support for the newer range. Version 0.19's further
breaking changes are not included.

TanStack's updated dependency tree resolves Seroval 1.8.0, removing the two
critical deserialization advisories in the previous 1.5.1 installation.

## Audit result and remaining work

`bun audit --json`: **26 flagged package names initially, 4 after the first pass,
1 after the follow-up.** One moderate advisory remains; no critical, high, or low
findings remain in the installed dependency graph. This is a dependency audit,
not a full exploitability assessment.

Follow-up remediation:

- Use the official `shadcn eject` command to inline the existing CSS unchanged and
  remove the generator dependency. The installed `deepmerge` and `minimatch`
  dependency chains disappear, rather than being replaced with incompatible or
  nonexistent patches. A CSS syntax-tree comparison confirmed the preserved
  styles match the original upstream stylesheet. Keep its MIT attribution.
- The on-demand shadcn generator itself is **not patched** by this removal. It
  still needs trusted input and separate review when used. See
  [UI component guidance](ui-components.md).
- Upgrade KaTeX to 0.18.11. Offline rendering checks cover equations through the
  real chat Markdown component and verify inherited `trust` settings cannot
  enable unsafe links. No paid model or API request is involved.

| Remaining package | Severity | Reason not forced in this update |
| --- | --- | --- |
| `esbuild` 0.18.20 | Moderate | Drizzle Kit 0.31.11 is still the latest stable release and retains legacy `@esbuild-kit/esm-loader`, which constrains this version. The advisory concerns esbuild's development server; Vite uses the unaffected 0.25.12 branch. Do not expose an esbuild development server. The separate Windows finding is fixed through `tsx` 4.23.15 and esbuild 0.28.2. Await a supported legacy-loader fix rather than forcing incompatible overrides or changing database tooling. [Advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |

No advisories are suppressed. `bun audit` still exits nonzero for the remaining
moderate finding.

## Validation

Passed:

- `bun run check-types` (includes the frontend production build and UI/API type checks)
- API and receipt processor bundles at the time of the audit. For current API build and validation commands, see the [Web Function runbook](web-function-cutover.md).
- `bun install --frozen-lockfile --ignore-scripts`
- `git diff --check`
- Offline chat Markdown/KaTeX rendering and inherited-trust regression checks
- Ejected CSS syntax-tree comparison against the original shadcn 4.23.0 stylesheet

When reusing an existing installation after changing overrides, run
`bun install --force --ignore-scripts` to relink cached dependencies. Verify the
actual imported module versions, not just the lockfile; a stale link was caught
and corrected during the offline checks.

The frontend retains its existing large-chunk build warning. No database pushes,
paid model calls, browser chat validation, merges, or deployments were performed.
