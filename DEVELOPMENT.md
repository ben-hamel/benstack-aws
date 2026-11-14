# Development

## Dev environments

Pick whichever works best for you:

- [Local](docs/local.md) — run directly on your host
- [Lima VM](docs/lima.md) — lightweight VM via Lima (macOS only)
- [Dev Container](docs/dev-container.md) — Docker-based container with VS Code Dev Containers

## Remote development with Vite proxying

Start each server in a separate Rex pane using explicit settings. No network
launcher scripts or saved env overrides are required. Example for this dev VM:

```bash
env WEB_FUNCTION_LOCAL_ENDPOINT=127.0.0.1:3000 \
  BETTER_AUTH_URL=http://100.67.130.3:3001 \
  CORS_ORIGIN=http://100.67.130.3:3001 \
  bun run --cwd apps/server dev:web-function

env DEV_SERVER_HOST=100.67.130.3 DEV_API_PROXY=1 \
  DEV_API_PROXY_TARGET=http://127.0.0.1:3000 \
  VITE_SERVER_URL=http://100.67.130.3:3001 \
  bun run --cwd apps/web dev --strictPort
```

Open http://100.67.130.3:3001 with Tailscale connected. The API stays on loopback
and Vite proxies /api, including auth. These process settings do not edit .env
files. Existing API env files still supply credentials and the database URL.
The real app performs its usual database setup; AI/upload actions can incur
their normal usage costs. Nothing is deployed by these commands.

For local-only access, replace 100.67.130.3 with 127.0.0.1 in both commands.
Vite proxying is opt-in and dev-only; production builds still use the configured
VITE_SERVER_URL and existing separate-origin infrastructure. The original
ordinary dev commands remain unchanged. See [auth upgrade notes](docs/dev-auth-upgrade.md).

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
