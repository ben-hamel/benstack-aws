# UI components

The app composes today's shadcn primitives directly. There is no legacy
`ai-elements/` compatibility layer and no copy of the entire registry.

## Current sources

- Source generated with shadcn CLI 4.23.0 and the existing `base-lyra` theme.
  Its official `eject` command inlined `shadcn/tailwind.css` into `globals.css`,
  retaining upstream styling and its MIT license without installing the CLI's
  generator dependencies in the application.
- Base UI 1.9.0.
- `@shadcn/react` 0.3.1 for Message Scroller.
- Primitive source fetched with the official CLI, including workspace import
  and Lucide icon transformations.

## App composition

`apps/web/src/routes/chat.tsx` uses Message Scroller's provider, viewport,
content, items and button directly. It supplies message IDs, user scroll
anchors and busy state. Suggestions are Buttons; the composer is Input Group;
receipt chips use Hover Card and Button directly and retain their detail dialog.

`apps/web/src/components/chat/chat-message.tsx` renders one Message per SDK
message, uses Bubble for user text, and composes Trace/Code Block for tool
activity. AI SDK helpers recognize static and dynamic tools. Labels derive
from SDK state, not a separate execution state machine. The file also renders
reasoning and source URL parts, using controlled collapsibles and safe links.
It contains application-specific presentation, not old generic API adapters.

`apps/web/src/components/chat/markdown.tsx` owns Streamdown and its plugins.
These rendering dependencies belong to the web app, not the generic UI library.
No AI SDK major version, backend, model, API route, auth flow or database schema
was changed by the direct-composition refactor. Historical message IDs use the
SDK's generateId helper, avoiding a secure-context-only browser API for UI keys.

## Scope and cleanup

The old registry's 43 unused AI Elements copies and 13 unused primitive
components were removed first. After switching the live app to direct imports,
the five compatibility wrappers and another five unreferenced primitive files
were removed too. Their exclusive UI dependencies were pruned, including React
Flow, Rive, media-chrome, motion, cmdk, nanoid, react-jsx-parser, ansi-to-react,
tokenlens, the Radix state hook, direct shiki, use-stick-to-bottom and Embla.
Streamdown's own highlighting dependencies are retained transitively.

The utils file remains as part of the configured CLI scaffold; components.json
still maps its utils alias there. All retained UI source is type-checked; no
blanket AI Elements exclusion remains. Deleted source is recoverable from Git.

## Adding a component later

From `packages/ui`:

```bash
bun --no-env-file x shadcn@4.23.0 add COMPONENT_NAME
```

Run the generator on demand rather than keeping `shadcn` installed. The generator
still has upstream advisories in its own tooling dependencies; use trusted registry
input, review updates before running it, and review every generated diff. Ejected
styles do not receive CLI CSS updates automatically: explicitly review and refresh
the upstream CSS snapshot when upgrading component source. Keep the ejected marker
and MIT notice. `@shadcn/react` remains installed for runtime components.

Install only what the feature needs, review its diff, and use the Base UI variant.
For AI patterns, compose the primitives from https://ui.shadcn.com/docs/ai-elements.
Do not reinstall the retired legacy registry or add old wrapper APIs.

Validation is type checking and production bundling plus user-driven browser
checks. No paid model calls or automated browser suites are required here.

## References

- https://ui.shadcn.com/docs/ai-elements
- https://ui.shadcn.com/docs/ai-elements/base/chat
- https://ui.shadcn.com/docs/ai-elements/base/message
- https://ui.shadcn.com/docs/ai-elements/base/tool
- https://ui.shadcn.com/docs/components/base/message-scroller
