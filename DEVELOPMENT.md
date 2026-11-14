# Development

## Dev environments

Pick whichever works best for you:

- [Local](docs/local.md) — run directly on your host
- [Lima VM](docs/lima.md) — lightweight VM via Lima (macOS only)
- [Dev Container](docs/dev-container.md) — Docker-based container with VS Code Dev Containers

## Local or remote development with Vite proxying

From the repository root:

```bash
bun run dev:local    # http://127.0.0.1:3001, this machine only
bun run dev:network  # detects Tailscale IPv4 and prints your remote browser link
```

Both start the full Node/Hono API and Vite frontend. Stop existing servers on
ports 3000/3001 first. In network mode your browser needs Tailscale connected;
only the frontend binds to the Tailscale interface. The API remains on loopback
and Vite forwards `/api/*`, including Better Auth, without changing paths or
cookies. Auth base URL, trusted origin and browser API URL are aligned by the
launcher. Settings are passed to child processes; your env files are unchanged.
Ctrl+C stops both servers. Vite hot reload works as usual; restart for API edits.
Run either command inside Rex if you want it to remain running after disconnect.

The API still uses `apps/server/.env` / `.env.development` / `.env.local` for
credentials and database settings. Starting the real app performs its normal
DB/checkpointer initialization, and real AI/upload actions can incur their usual
provider/storage costs. These commands never deploy or provision anything.
The original `bun run dev` and `dev:server` commands retain their prior behavior.

Proxying is opt-in for manual Vite launches with `DEV_API_PROXY=1`; the backend
must use the browser-facing frontend URL for `BETTER_AUTH_URL` and `CORS_ORIGIN`.
The new launchers handle this automatically. **Vite's proxy is dev-only:** built
production assets still use `VITE_SERVER_URL` and the existing separate-origin
architecture. Production proxy adoption is a separate infrastructure decision.
Do not change production auth URLs to the frontend domain until routing exists.

Run `bun run --cwd apps/server test:auth` for isolated browser/auth regression
tests (requires Playwright Chromium), without a real DB or personal accounts.
See [auth upgrade notes](docs/dev-auth-upgrade.md) for validation and rollback.

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.
3. Apply the schema:

```bash
bun run db:push
```

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@benstack-aws/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `bun run db:prod`: Connect to the production RDS database via ECS Exec (requires AWS CLI + Session Manager plugin)
